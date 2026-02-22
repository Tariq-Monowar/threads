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
6. [Active Calls on Login / App Open](#active-calls-on-login--app-open)
7. [Full Call Flow — Step by Step](#full-call-flow--step-by-step)
   - [Caller Side](#caller-side)
   - [Receiver Side](#receiver-side)
   - [Joining a Call Already in Progress](#joining-a-call-already-in-progress)
8. [MediaSoup WebRTC Setup](#mediasoup-webrtc-setup)
9. [Participant Info & Conversation Info](#participant-info--conversation-info)
10. [Data Shapes](#data-shapes)
11. [Error Handling](#error-handling)
12. [Edge Cases](#edge-cases)

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

#### `get_active_calls` *(with optional callback)*
Request the list of group calls currently active in the user's conversations on-demand. Useful when the user opens the conversation list screen or pulls to refresh.

Uses the same optimized memory-first path as `join` — if no calls are active globally, the database is never queried.

```js
// Option A — with ack callback (recommended)
socket.emit('get_active_calls', {}, (res) => {
  if (res.error) return;
  // res.calls — array of active call entries, or [] if none
  res.calls.forEach(call => {
    showCallBadge(call.conversationId, call.conversationInfo, call.participantCount);
  });
});

// Option B — without callback (server emits 'active_group_calls' event back)
socket.emit('get_active_calls', {});
socket.on('active_group_calls', (res) => {
  res.calls.forEach(call => {
    showCallBadge(call.conversationId, call.conversationInfo, call.participantCount);
  });
});
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

#### `active_group_calls`
Fired automatically after `join` completes **if** the user has at least one active call in their conversations. Also fired as the response to `get_active_calls` when no callback is provided.

```js
socket.on('active_group_calls', (data) => {
  // data.calls — Array of active call entries ([] is never sent — event is skipped)
  data.calls.forEach(call => {
    // call.conversationId   — string
    // call.conversationInfo — { id, name, avatar }
    // call.participantCount — number of people currently in the call
    showJoinCallBanner(call);
  });
});
```

> When there are no active calls, this event is **not fired** on `join` (to avoid unnecessary work). Use `get_active_calls` with a callback if you need an explicit empty-state confirmation.

---

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

## Active Calls on Login / App Open

When a user opens the app (or reconnects after being offline), they need to know which of their group conversations already have a call running — so they can show a "Join call" banner on each conversation tile.

### How it works

The server keeps all active MediaSoup rooms in an **in-memory Map**. When `join` completes, the server uses a two-step optimized lookup:

1. **Memory check (free, no DB)** — read the list of currently active room IDs from the in-memory `mediasoupRooms` map. If zero rooms are active globally, the flow stops here — the database is never touched.
2. **Tiny targeted DB query (only when needed)** — if active rooms exist, query only the rows where `userId = me AND conversationId IN (<active room ids>)`. This returns at most a handful of rows regardless of how many groups the user is in.
3. **Participant count (free, no DB)** — counted from the in-memory `mediasoupParticipants` map.
4. Emits `active_group_calls` back **only to the joining socket**.

```
User opens app
      │
      ├── socket.emit('join', userId)
      │       │
      │       ├── [memory] check active rooms → 0 active? → done, no DB hit
      │       │
      │       └── [DB] SELECT WHERE userId=me AND conversationId IN (active ids)
      │                  ↓ (returns only 0–N rows, N = active rooms user is in)
      └── server → socket.emit('active_group_calls', { calls: [...] })
                         │
                         ├── conversationId
                         ├── conversationInfo { id, name, avatar }
                         └── participantCount  ← from memory, no extra DB call
```

> **Performance guarantee:** If nobody is on a call anywhere, zero DB queries are made on `join`. If 2 calls are active and the user is in 50 groups, only 2 rows are fetched — not 50.

### Recommended implementation

```js
// On app start / socket reconnect
socket.on('connect', () => {
  socket.emit('join', userId);
});

// Fires automatically after join — only if the user has active calls
socket.on('active_group_calls', ({ calls }) => {
  calls.forEach(({ conversationId, conversationInfo, participantCount }) => {
    // Show a "● Live · N people" badge on that conversation tile
    markConversationAsLive(conversationId, conversationInfo, participantCount);
  });
});

// Remove the badge when the call ends
socket.on('group_call_ended', ({ conversationId }) => {
  clearConversationLiveBadge(conversationId);
});
```

### On-demand refresh

If you need to re-check at any time (e.g. user pulls to refresh the conversation list):

```js
// With ack callback (recommended)
socket.emit('get_active_calls', {}, (res) => {
  if (res.error) return;
  refreshCallBadges(res.calls); // res.calls may be [] if nothing is active
});

// Without callback — server fires 'active_group_calls' back
socket.emit('get_active_calls', {});
```

> `get_active_calls` uses the **same optimized path** as `join` — memory-first, minimal DB.

### Active call entry shape

```ts
{
  conversationId: string;
  conversationInfo: {
    id: string;
    name: string;
    avatar: string | null; // full URL — may be null, show initials as fallback
  };
  participantCount: number; // how many people are currently in the call
}
```

### What triggers `active_group_calls`

| Trigger | Fires to |
|---|---|
| User emits `join` and has active calls | That socket only |
| User emits `get_active_calls` without callback | That socket only |
| User emits `get_active_calls` with callback | Returned via callback only |

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

There are two ways a user discovers an active call:

**While online (real-time):**
```
1. Listen for 'group_call_started'  → show "Join call" banner
2. Listen for 'group_call_ended'    → hide "Join call" banner
```

**After opening the app / reconnecting (catch-up):**
```
1. socket.emit('join', userId)
   → server automatically fires 'active_group_calls' if any calls are running
   → show "Join call" banners for each entry in calls[]
2. Listen for 'group_call_ended' → hide those banners
```

**Once the user taps "Join" (both cases are identical):**
```
3. socket.emit('createRoom', { roomId: conversationId }, cb)
   → Follow steps 3–8 from Caller Side
   → socket.emit('getProducers') to consume everyone already in the call
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
| "Join call" banner (real-time) | `conversationInfo.name`, `conversationInfo.avatar` | `group_call_started` |
| "Join call" banner (on app open) | `conversationInfo.name`, `conversationInfo.avatar` | `active_group_calls` |
| "Join call" badge count | `participantCount` | `active_group_calls` / `get_active_calls` |
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

### Active call entry (from `active_group_calls` and `get_active_calls`)

```ts
{
  conversationId: string;
  conversationInfo: {
    id: string;
    name: string;
    avatar: string | null;
  };
  participantCount: number;
}
```

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
| `get_active_calls` callback `error: "Not joined"` | `join` not emitted yet | Emit `join` first |

---

## Edge Cases

**User opens app while a call is running:**
`active_group_calls` fires automatically after `join`. No extra emit needed. The server does a memory-first check so this is fast even with many users connecting at once.

**No calls are active anywhere:**
`active_group_calls` is not emitted after `join` at all — zero events, zero DB queries. Use `get_active_calls` with a callback if your screen needs an explicit empty-state confirmation.

**User is in 100 groups, 2 have active calls:**
Only 2 DB rows are fetched — the query uses `conversationId IN (active room ids)`, not a full membership scan.

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

### Starting a call

```
Caller                    Server                    Other Members
  │                          │                           │
  │── join(userId) ─────────►│                           │
  │                          │── active_group_calls ─────►│  (if calls already active)
  │── group_call_initiate ──►│── group_call_incoming ───►│  (online members only)
  │                          │── group_call_started ─────►│  (all members)
  │── createRoom ───────────►│                           │
  │◄─ rtpCapabilities ───────│                           │
  │── createTransport (send)►│                           │
  │── createTransport (recv)►│                           │
  │── connectTransport ─────►│                           │
  │── produce (audio) ──────►│── newProducer ────────────►│
  │── produce (video) ──────►│── newProducer ────────────►│
  │                          │                           │
  │── leaveRoom ────────────►│── participantLeft ─────────►│
  │                          │── group_call_ended ────────►│  (if room now empty)
```

### Member joining a call already in progress

```
Late Joiner               Server                    In-call Participants
  │                          │                           │
  │── join(userId) ─────────►│                           │
  │◄─ active_group_calls ────│  [memory-first, fast]     │
  │   { conversationId,      │                           │
  │     conversationInfo,    │                           │
  │     participantCount }   │                           │
  │                          │                           │
  │  [user taps Join]        │                           │
  │── createRoom ───────────►│                           │
  │◄─ rtpCapabilities ───────│                           │
  │── createTransport x2 ───►│                           │
  │── connectTransport ─────►│                           │
  │── getProducers ─────────►│                           │
  │◄─ producers[] ───────────│  (each with participantInfo)
  │── consume (each) ───────►│                           │
  │── produce (audio) ──────►│── newProducer ────────────►│
  │── produce (video) ──────►│── newProducer ────────────►│
```

### On-demand active call check

```
Any User                  Server
  │                          │
  │── get_active_calls ─────►│
  │                          ├── [memory] active room ids → [] ? → return calls: []
  │                          └── [DB] WHERE userId=me AND convId IN (active ids)
  │◄─ callback({ calls })────│  (or 'active_group_calls' event if no callback)
```
