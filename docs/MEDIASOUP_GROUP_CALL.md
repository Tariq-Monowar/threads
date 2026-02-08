# Mediasoup Group Call – Frontend Guide

This document explains how **group video/audio calls** work in this project: backend (Socket.IO + mediasoup) and how the frontend should integrate. Reference implementation: **`learn/index.html`**. Backend logic: **`src/plugins/socket.ts`**.

---

## 1. What is mediasoup?

- **mediasoup** is an SFU (Selective Forwarding Unit): the server receives media from each participant and forwards it to others. It does **not** mix streams; each client gets separate audio/video tracks.
- **Room** = one mediasoup **Router** per `roomId`. In this app, **`roomId` = `conversationId`** (one group call per conversation).
- Only **conversation members** (from Prisma `ConversationMember`) can join that room; the server checks membership before allowing `createRoom`.

---

## 2. Data model (Prisma)

Relevant for group calls:

- **Conversation** – `id` (cuid) = conversation ID used as mediasoup `roomId`.
- **ConversationMember** – `userId`, `conversationId`, `isDeleted: false` → user is a member and can join the group call.

The server uses these to:

- Allow/deny **Start group call** and **Join room**.
- Decide who receives **group_call_incoming** and **group_call_started** / **group_call_ended**.

---

## 3. Prerequisites (before any group call)

1. **Connect** Socket.IO to the backend (e.g. `io(serverUrl)`).
2. **Identify the user** so the server can check group membership and route events:
   - Emit **`join`** with the current user’s ID (string):
   - `socket.emit('join', userId)`  
   - Example: `socket.emit('join', '5')`.
3. Use **mediasoup-client** in the browser (e.g. from CDN or npm). See `learn/index.html` for loading it.

Without `join(userId)`, the server will reject **createRoom** with *"Join first with your user ID"*.

---

## 4. High-level flow

```
1. User connects socket → emit("join", userId)
2. Start call OR receive "group_call_incoming" / "group_call_started"
3. createRoom(conversationId)  ← roomId = conversationId
4. Load mediasoup Device with router RTP capabilities
5. createTransport (send) + createTransport (recv)
6. connectTransport for each when they fire "connect"
7. Produce local audio/video (send transport)
8. getProducers → consume each remote producer (recv transport)
9. Listen for newProducer → consume new producers
10. On leave → leaveRoom
```

---

## 5. Socket events reference

All events below are **Socket.IO** events. Callbacks `cb` are the last argument of `emit(event, payload, cb)`.

### 5.1 Client → Server (you emit)

| Event | Payload | Callback / Notes |
|--------|---------|-------------------|
| **join** | `userId: string` | None. Do this once after connect. |
| **group_call_initiate** | `{ callerId, conversationId, callType?, callerName?, callerAvatar? }` | No callback. Server checks membership; if not a member, you get **group_call_error**. |
| **createRoom** | `{ roomId: string }` | `cb({ rtpCapabilities?, error? })`. Use **conversationId** as **roomId**. Fails if user not in group or not joined. |
| **createTransport** | `{ type: string }` | `cb({ id?, iceParameters?, iceCandidates?, dtlsParameters?, error? })`. Call twice: one for send, one for recv. |
| **connectTransport** | `{ transportId, dtlsParameters }` | `cb({ success?, error? })`. Called from transport’s `connect` event. |
| **produce** | `{ transportId, kind, rtpParameters }` | `cb({ id?, error? })`. `kind`: `"audio"` \| `"video"`. |
| **consume** | `{ transportId, producerId, rtpCapabilities }` | `cb({ id?, producerId?, kind?, rtpParameters?, error? })`. |
| **getProducers** | (none or `{}`) | `cb({ producers?: [{ id, kind, socketId }], error? })`. List producers already in the room. |
| **resumeConsumer** | `{ consumerId }` | `cb({ success?, error? })`. Call after creating a consumer (e.g. to resume if paused). |
| **leaveRoom** | (none) | No callback. Leaves the mediasoup room and cleans up. |

### 5.2 Server → Client (you listen)

| Event | Payload | When |
|--------|---------|------|
| **group_call_error** | `{ message: string }` | e.g. "You are not in this group" (caller not a member). |
| **group_call_incoming** | `{ callerId, conversationId, callType, callerInfo }` | Incoming ring for this group. Show Accept/Decline. |
| **group_call_started** | `{ conversationId }` | A group call is in progress for this conversation. Show “You can join”. |
| **group_call_ended** | `{ conversationId }` | Call ended (last participant left). Hide “You can join”. |
| **newProducer** | `{ producerId, kind, socketId }` | New remote producer in the room. Create a consumer for it (recv transport). |
| **participantLeft** | `{ socketId }` | Remote participant left. Remove their consumers and UI. |

---

## 6. Step-by-step frontend flow

### 6.1 Start a group call (caller)

1. Emit **group_call_initiate**:
   ```js
   socket.emit('group_call_initiate', {
     callerId: userId,
     conversationId: conversationId,
     callType: 'video',
     callerName: displayName,
     callerAvatar: avatarUrl || null
   });
   ```
2. If you get **group_call_error**, show the message and stop.
3. Then **join the room** (same as “Join” flow below) using `conversationId` as `roomId`.

### 6.2 Join an existing call (“You can join” or after Accept)

1. **createRoom** with `roomId = conversationId`:
   ```js
   socket.emit('createRoom', { roomId: conversationId }, (res) => {
     if (res.error) return showError(res.error);
     // res.rtpCapabilities = router RTP capabilities
     loadDeviceAndTransports(res.rtpCapabilities);
   });
   ```
2. Load mediasoup **Device**: `device.load({ routerRtpCapabilities: res.rtpCapabilities })`.
3. Create **send** and **recv** transports (each via **createTransport**), then create `SendTransport` / `RecvTransport` from mediasoup-client with the returned `id`, `iceParameters`, `iceCandidates`, `dtlsParameters`.
4. On each transport’s **connect** event, call **connectTransport** with `transportId` and `dtlsParameters`.
5. **Produce**: get user media, then for each track use send transport’s `produce({ track })`; when it fires **produce**, emit **produce** to server with `transportId`, `kind`, `rtpParameters`; callback gives producer `id`.
6. **getProducers**: emit **getProducers**, then for each producer (except your own `socketId`) call **consume** with your recv `transportId`, `producerId`, and `device.rtpCapabilities`.
7. For each **consume** callback, create a **Consumer** on the recv transport with `id`, `producerId`, `kind`, `rtpParameters`, then attach `consumer.track` to a video/audio element. Optionally call **resumeConsumer** with `consumer.id`.
8. On **newProducer**, same as step 6–7 for the new `producerId` (use recv transport and `device.rtpCapabilities`).
9. On **participantLeft** with `socketId`, remove all consumers and UI for that `socketId`.

### 6.3 Leave the call

- Emit **leaveRoom** (no payload). Then close local producers/consumers and transports, and stop local media tracks.

---

## 7. Helper: request with callback

Socket events that expect a callback are request-response. Example helper:

```js
function socketRequest(event, data = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (res) => {
      if (res.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

// Usage
const { rtpCapabilities } = await socketRequest('createRoom', { roomId: conversationId });
```

See **`learn/index.html`** for full usage (createRoom, createTransport, produce, consume, getProducers, resumeConsumer, leaveRoom).

---

## 8. File reference

| File | Purpose |
|------|--------|
| **src/plugins/socket.ts** | Backend: mediasoup worker, router per room, createRoom/createTransport/produce/consume/leaveRoom, group_call_* events, membership checks via Prisma. |
| **learn/index.html** | Reference frontend: connect, join(userId), group call UI, createRoom → Device → transports → produce/consume, newProducer, participantLeft, leaveRoom. |
| **prisma/schema.prisma** | Conversation, ConversationMember: used to enforce “user is in group” for createRoom and group_call_initiate. |

---

## 9. Summary for frontend

1. **Connect** socket and **emit `join` with `userId`** before any group call.
2. **Room ID** = **conversation ID**; only members of that conversation can **createRoom** or **group_call_initiate**.
3. **Order**: createRoom → load Device → create send/recv transports → connect them → produce local media → getProducers + consume → listen newProducer/participantLeft → on leave emit **leaveRoom**.
4. **Group UX**: listen **group_call_incoming** (ring), **group_call_started** (“you can join”), **group_call_ended** (call over), **group_call_error** (e.g. not in group).

For a minimal working example, follow **learn/index.html** and the event table above.
