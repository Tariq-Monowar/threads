# Group Call — Socket Integration Guide

> For frontend developers integrating real-time group video/audio calls into the **Threads** mobile or web app.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Dependencies](#dependencies)
4. [Connection Setup](#connection-setup)
5. [Socket Events Reference](#socket-events-reference)
   - [Events You Emit (Client → Server)](#events-you-emit-client--server)
   - [Events You Listen To (Server → Client)](#events-you-listen-to-server--client)
6. [Full Call Flow — Step by Step](#full-call-flow--step-by-step)
   - [Caller Side](#caller-side)
   - [Receiver Side](#receiver-side)
   - [Joining a Call Already in Progress](#joining-a-call-already-in-progress)
7. [MediaSoup WebRTC Setup](#mediasoup-webrtc-setup)
8. [Participant Info & Conversation Info](#participant-info--conversation-info)
9. [Data Shapes](#data-shapes)
10. [Error Handling](#error-handling)
11. [Edge Cases](#edge-cases)

---

## Overview

Group calls in Threads use **Socket.IO** for signalling and **MediaSoup** (SFU) for media routing. Unlike peer-to-peer calls, every participant sends their media to the server, and the server distributes it to everyone else. This means:

- No direct peer connections between users.
- The server handles all media routing.
- Participants can join or leave at any time without breaking others' connections.
- User name, avatar, and conversation info are all sent by the server automatically — you do **not** need to pass them manually from the frontend.

---

## Architecture

```
Flutter / Web App
       │
       │  Socket.IO (signalling)
       ▼
  Threads Backend  ──── MediaSoup Worker (SFU)
       │                      │
       │  group_call_incoming  │  Audio/Video streams
       ▼                      ▼
  Other Participants  ◄──── MediaSoup Router (per conversation)
```

---

## Dependencies

| Library | Version | Purpose |
|---|---|---|
| `socket.io-client` | 4.x | Signalling |
| `mediasoup-client` | 3.6.x | WebRTC media (SFU) |

**Install:**

```bash
# npm / yarn
npm install socket.io-client mediasoup-client

# Flutter (add to pubspec.yaml)
socket_io_client: ^2.x.x
# Use a native WebRTC package + mediasoup-client-flutter if available
```

---

## Connection Setup

### Step 1 — Connect and register your userId

```js
const socket = io('http://your-server:8000');

socket.on('connect', () => {
  socket.emit('join', userId); // userId is a string, e.g. "42"
});
```

> You **must** emit `join` with your userId before doing anything else. The server uses this to route events to the right user.

---

## Socket Events Reference

### Events You Emit (Client → Server)

#### `join`
Register your user on connect.

```js
socket.emit('join', userId); // string
```

---

#### `group_call_initiate`
Start a group call in a conversation. The server automatically fetches all member info and conversation info from the database and notifies everyone.

```js
socket.emit('group_call_initiate', {
  callerId: '42',          // your user ID (string)
  conversationId: 'abc123', // the group conversation ID
  callType: 'video',        // 'video' | 'audio'
});
```

> After emitting this, the caller should immediately call `createRoom` (join MediaSoup room).

---

#### `createRoom` *(with callback)*
Join or create a MediaSoup room for the given conversation. Returns the router's RTP capabilities needed to create a MediaSoup Device.

```js
socket.emit('createRoom', { roomId: conversationId }, (response) => {
  if (response.error) { /* handle error */ return; }
  const { rtpCapabilities } = response;
  // Use rtpCapabilities to load your mediasoup-client Device
});
```

---

#### `createTransport` *(with callback)*
Create a WebRTC transport. Call this **twice** — once for sending, once for receiving.

```js
socket.emit('createTransport', { type: 'send' }, (res) => { /* use res to create sendTransport */ });
socket.emit('createTransport', { type: 'recv' }, (res) => { /* use res to create recvTransport */ });
```

Response shape:
```js
{
  id: string,
  iceParameters: object,
  iceCandidates: array,
  dtlsParameters: object,
}
```

---

#### `connectTransport` *(with callback)*
Connect a transport (triggered by the mediasoup-client `connect` event).

```js
socket.emit('connectTransport', {
  transportId: transport.id,
  dtlsParameters: dtlsParameters,
}, (res) => { /* res.success or res.error */ });
```

---

#### `produce` *(with callback)*
Start producing a media track (audio or video).

```js
socket.emit('produce', {
  transportId: sendTransport.id,
  kind: 'video',         // 'audio' | 'video'
  rtpParameters: rtpParameters,
}, (res) => {
  const { id } = res; // producer ID
});
```

---

#### `getProducers` *(with callback)*
Get a list of all existing producers in the room (for participants who joined mid-call).

```js
socket.emit('getProducers', (res) => {
  const { producers } = res;
  // producers: Array<{ id, kind, socketId, participantInfo }>
});
```

---

#### `consume` *(with callback)*
Start consuming a remote participant's media track.

```js
socket.emit('consume', {
  transportId: recvTransport.id,
  producerId: remoteProducerId,
  rtpCapabilities: device.rtpCapabilities,
}, (res) => {
  const { id, producerId, kind, rtpParameters } = res;
  // Create a consumer with recvTransport.consume(...)
});
```

---

#### `resumeConsumer` *(with callback)*
Resume a consumer after creation (required — consumers start paused).

```js
socket.emit('resumeConsumer', { consumerId: consumer.id }, (res) => { /* res.success */ });
```

---

#### `leaveRoom`
Leave the MediaSoup room. Call this when the user ends the call.

```js
socket.emit('leaveRoom');
```

---

### Events You Listen To (Server → Client)

#### `group_call_incoming`
Fired on all online group members (except the caller) when someone starts a call.

```js
socket.on('group_call_incoming', (data) => {
  // data.callerId          — string, user ID of the caller
  // data.conversationId    — string
  // data.callType          — 'video' | 'audio'
  // data.callerInfo        — { id, name, avatar }
  // data.conversationInfo  — { id, name, avatar }
});
```

Use `callerInfo` and `conversationInfo` to build your incoming call UI (name, avatar, group name).

---

#### `group_call_started`
Fired to **all members** of the conversation (including the caller) when the first person joins the MediaSoup room.

```js
socket.on('group_call_started', (data) => {
  // data.conversationId   — string
  // data.conversationInfo — { id, name, avatar }
  // data.callerInfo       — { id, name, avatar } (only present from group_call_initiate flow)
});
```

Use this to show a "Join call" banner for members who haven't joined yet.

---

#### `group_call_ended`
Fired to all members when the last person leaves the room.

```js
socket.on('group_call_ended', (data) => {
  // data.conversationId — string
  // Hide the "Join call" banner
});
```

---

#### `group_call_error`
Fired back to the caller if something went wrong (e.g. not a member, invalid ID).

```js
socket.on('group_call_error', (data) => {
  // data.message — string describing the error
});
```

---

#### `newProducer`
Fired to everyone in the room when a new participant starts sending media. Consume it immediately.

```js
socket.on('newProducer', async ({ producerId, kind, socketId, participantInfo }) => {
  // producerId      — string, the new producer's ID
  // kind            — 'audio' | 'video'
  // socketId        — string, the remote socket that produced it
  // participantInfo — { userId, name, avatar } — use to label the video tile
});
```

---

#### `participantLeft`
Fired to everyone in the room when someone leaves.

```js
socket.on('participantLeft', ({ socketId }) => {
  // Remove that participant's video tile from your UI
});
```

---

## Full Call Flow — Step by Step

### Caller Side

```
1. socket.emit('join', userId)
2. socket.emit('group_call_initiate', { callerId, conversationId, callType })
3. socket.emit('createRoom', { roomId: conversationId }, cb)
   → Load mediasoup Device with cb.rtpCapabilities
4. socket.emit('createTransport', { type: 'send' }, cb)  → create sendTransport
   socket.emit('createTransport', { type: 'recv' }, cb)  → create recvTransport
5. Get camera/mic stream via getUserMedia
6. sendTransport.produce(audioTrack)  → triggers 'produce' event → socket.emit('produce', ...)
   sendTransport.produce(videoTrack)  → same
7. socket.emit('getProducers', cb)  → consume existing participants' streams
8. Listen for 'newProducer' to consume participants who join later
```

### Receiver Side

```
1. socket.emit('join', userId)
2. Listen for 'group_call_incoming'
   → Show incoming call UI with callerInfo + conversationInfo
3. On "Accept":
   socket.emit('createRoom', { roomId: conversationId }, cb)
   → Follow steps 3–8 from Caller Side
4. On "Decline":
   → Simply dismiss the UI (no socket event needed for group calls)
```

### Joining a Call Already in Progress

```
1. Listen for 'group_call_started'  → show "Join call" banner
2. Listen for 'group_call_ended'    → hide "Join call" banner
3. On user taps "Join":
   socket.emit('createRoom', { roomId: conversationId }, cb)
   → Follow steps 3–8 from Caller Side
   → Use 'getProducers' to get all current streams
```

---

## MediaSoup WebRTC Setup

The complete handshake for setting up media:

```js
// 1. Load device
const device = new mediasoupClient.Device();
await device.load({ routerRtpCapabilities: rtpCapabilities });

// 2. Create send transport
const { id, iceParameters, iceCandidates, dtlsParameters } = await socketRequest('createTransport', { type: 'send' });
const sendTransport = device.createSendTransport({ id, iceParameters, iceCandidates, dtlsParameters });

sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
  await socketRequest('connectTransport', { transportId: sendTransport.id, dtlsParameters });
  callback();
});

sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
  const { id } = await socketRequest('produce', { transportId: sendTransport.id, kind, rtpParameters });
  callback({ id });
});

// 3. Create recv transport (same shape, type: 'recv')

// 4. Produce local tracks
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
await sendTransport.produce({ track: stream.getAudioTracks()[0] });
await sendTransport.produce({ track: stream.getVideoTracks()[0] });

// 5. Consume a remote producer
const { id, producerId, kind, rtpParameters } = await socketRequest('consume', {
  transportId: recvTransport.id,
  producerId: remoteProducerId,
  rtpCapabilities: device.rtpCapabilities,
});
const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters });
await socketRequest('resumeConsumer', { consumerId: consumer.id });

// Attach consumer.track to a <video> element
videoElement.srcObject = new MediaStream([consumer.track]);
```

> `socketRequest` is a helper that wraps `socket.emit` in a Promise using the ack callback pattern.

---

## Participant Info & Conversation Info

The server automatically fetches names and avatars from the database. You never need to pass them manually. Here's where each piece of info arrives:

| Where it appears | Field | Source event |
|---|---|---|
| Incoming call UI | `callerInfo.name`, `callerInfo.avatar` | `group_call_incoming` |
| Incoming call UI | `conversationInfo.name`, `conversationInfo.avatar` | `group_call_incoming` |
| "Join call" banner | `conversationInfo.name`, `conversationInfo.avatar` | `group_call_started` |
| Video tile label | `participantInfo.name`, `participantInfo.avatar` | `newProducer` |
| Video tile label (late joiners) | `participantInfo` in each producer | `getProducers` callback |

### `callerInfo` shape

```json
{
  "id": 42,
  "name": "Alice",
  "avatar": "https://your-server/uploads/avatars/alice.jpg"
}
```

### `conversationInfo` shape

```json
{
  "id": "conv_abc123",
  "name": "Team Alpha",
  "avatar": "https://your-server/uploads/avatars/team_alpha.jpg"
}
```

> `avatar` can be `null` — always handle the fallback case (show initials or a placeholder).

### `participantInfo` shape (on producers)

```json
{
  "userId": "42",
  "name": "Alice",
  "avatar": "https://your-server/uploads/avatars/alice.jpg"
}
```

---

## Data Shapes

### `socketRequest` helper (recommended pattern)

```js
function socketRequest(event, data = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response) => {
      if (response.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
```

### Producer list item (from `getProducers`)

```ts
{
  id: string;            // mediasoup producer ID
  kind: 'audio' | 'video';
  socketId: string;      // which socket is producing
  participantInfo?: {
    userId: string;
    name: string;
    avatar: string | null;
  };
}
```

### `newProducer` event payload

```ts
{
  producerId: string;
  kind: 'audio' | 'video';
  socketId: string;
  participantInfo?: {
    userId: string;
    name: string;
    avatar: string | null;
  };
}
```

---

## Error Handling

| Error event | When it fires | What to do |
|---|---|---|
| `group_call_error` | Caller is not in the group, invalid ID, DB error | Show error message to user |
| `createRoom` callback `error: "Join first..."` | `join` was not emitted before `createRoom` | Emit `join` first, then retry |
| `createRoom` callback `error: "You are not in this group"` | User is not a member of the conversation | Do not proceed |
| `consume` callback `error: "RTP capabilities mismatch"` | Device not loaded yet | Wait for device load, retry |

---

## Edge Cases

**User joins mid-call:**
Call `getProducers` right after `createRoom` to get all existing streams. Each producer in the list includes `participantInfo` for labelling the video tile.

**Audio only / video only devices:**
The server accepts producers for whichever tracks exist. If the user has no camera, only produce audio. The other side handles missing video gracefully.

**Participant disconnects unexpectedly:**
The `participantLeft` event fires with the `socketId`. Remove the video tile for that socket.

**Avatar is null:**
Always check before setting an `<img src>`. Show the first letter of the name as a fallback.

**Call ends while a user is joining:**
`group_call_ended` fires to all members. If `currentRoomId` matches, clean up the call and return to the idle screen.

**Multiple sockets per user (user logged in on two devices):**
The server emits to the `userId` room, so both devices receive events. Each device must manage its own mediasoup state independently.

---

## Summary Diagram

```
Caller                    Server                    Other Members
  │                          │                           │
  │── join(userId) ─────────►│                           │
  │── group_call_initiate ──►│── group_call_incoming ───►│
  │                          │── group_call_started ─────►│ (all)
  │── createRoom ───────────►│                           │
  │◄─ rtpCapabilities ───────│                           │
  │── createTransport (send)►│                           │
  │── createTransport (recv)►│                           │
  │── connectTransport ─────►│                           │
  │── produce (audio) ──────►│── newProducer ────────────►│
  │── produce (video) ──────►│── newProducer ────────────►│
  │                          │                           │
  │                          │  [Member accepts]         │
  │                          │◄── createRoom ────────────│
  │                          │◄── produce (audio/video) ─│
  │◄─ newProducer ───────────│                           │
  │                          │                           │
  │── leaveRoom ────────────►│── participantLeft ─────────►│
  │                          │── group_call_ended (if empty)►│
```
