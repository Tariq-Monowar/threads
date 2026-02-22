# Group Call — Events Quick Reference

> Clean reference table for frontend developers.  
> All events are Socket.IO. All IDs are `string` unless noted.

---

## Legend

| Symbol | Meaning |
|---|---|
| `→` | You **emit** this to the server |
| `←` | Server **emits** this to you |
| `⇄` | You emit with an **ack callback** — server replies via that callback |
| `*` | Field is optional / may be `null` |

---

## 1. Emit to Server (`→` and `⇄`)

| # | Event | Direction | Payload | Ack Response |
|---|---|---|---|---|
| 1 | `join` | `→` | `userId: string` | — |
| 2 | `get_active_calls` | `→` or `⇄` | `{}` *(empty object)* | `{ calls: ActiveCall[] }` or `{ error: string }` |
| 3 | `group_call_initiate` | `→` | `{ callerId, conversationId, callType }` | — |
| 4 | `createRoom` | `⇄` | `{ roomId: string }` | `{ rtpCapabilities }` or `{ error }` |
| 5 | `createTransport` | `⇄` | `{ type: "send" \| "recv" }` | `{ id, iceParameters, iceCandidates, dtlsParameters }` or `{ error }` |
| 6 | `connectTransport` | `⇄` | `{ transportId, dtlsParameters }` | `{ success: true }` or `{ error }` |
| 7 | `produce` | `⇄` | `{ transportId, kind, rtpParameters }` | `{ id: string }` or `{ error }` |
| 8 | `getProducers` | `⇄` | *(no payload)* | `{ producers: Producer[] }` |
| 9 | `consume` | `⇄` | `{ transportId, producerId, rtpCapabilities }` | `{ id, producerId, kind, rtpParameters }` or `{ error }` |
| 10 | `resumeConsumer` | `⇄` | `{ consumerId: string }` | `{ success: true }` or `{ error }` |
| 11 | `media_state_change` | `→` | `{ video: bool, audio: bool }` | — |
| 12 | `leaveRoom` | `→` | *(no payload)* | — |

---

## 2. Listen from Server (`←`)

| # | Event | Fires when | Payload |
|---|---|---|---|
| 1 | `active_group_calls` | After `join` (if calls exist), or response to `get_active_calls` without callback | `{ calls: ActiveCall[] }` |
| 2 | `group_call_incoming` | Someone starts a call in your group | `{ callerId, conversationId, callType, callerInfo, conversationInfo }` |
| 3 | `group_call_started` | First person joins the MediaSoup room | `{ conversationId, conversationInfo }` |
| 4 | `group_call_ended` | Last person leaves the room | `{ conversationId }` |
| 5 | `group_call_error` | Call initiation failed | `{ message: string }` |
| 6 | `newProducer` | Someone in the room starts sending audio/video | `{ producerId, kind, socketId, participantInfo* }` |
| 7 | `media_state_change` | Someone in the room changes their camera/mic state | `{ video, audio, conversationId, socketId, userInfo }` |
| 8 | `participantLeft` | Someone in the room disconnects or leaves | `{ socketId: string }` |
| 9 | `online-users` | Any user connects or disconnects | `string[]` — array of online userIds |

---

## 3. Payload Field Types

### `join` → payload
```
userId: string          // e.g. "42"
```

### `get_active_calls` → payload
```
{}                      // empty object, no fields needed
```

### `group_call_initiate` → payload
```
callerId:       string           // your user ID
conversationId: string           // the group conversation ID
callType:       "video" | "audio"
```

### `createRoom` ⇄ payload / response
```
// Send:
roomId: string

// Ack response (success):
rtpCapabilities: RtpCapabilities   // mediasoup RTP capabilities object

// Ack response (error):
error: string
```

### `createTransport` ⇄ payload / response
```
// Send:
type: "send" | "recv"

// Ack response (success):
id:             string
iceParameters:  object
iceCandidates:  object[]
dtlsParameters: object

// Ack response (error):
error: string
```

### `connectTransport` ⇄ payload / response
```
// Send:
transportId:    string
dtlsParameters: object   // from mediasoup-client transport 'connect' event

// Ack response:
success: true
// or
error: string
```

### `produce` ⇄ payload / response
```
// Send:
transportId:    string
kind:           "audio" | "video"
rtpParameters:  object   // from mediasoup-client transport 'produce' event

// Ack response:
id: string               // the new producer ID
// or
error: string
```

### `getProducers` ⇄ response
```
producers: Producer[]
```

### `consume` ⇄ payload / response
```
// Send:
transportId:    string
producerId:     string
rtpCapabilities: object  // device.rtpCapabilities

// Ack response (success):
id:             string
producerId:     string
kind:           "audio" | "video"
rtpParameters:  object

// Ack response (error):
error: string
```

### `resumeConsumer` ⇄ payload / response
```
// Send:
consumerId: string

// Ack response:
success: true
// or
error: string
```

### `media_state_change` → payload
```
video: boolean    // true = camera ON,  false = camera OFF
audio: boolean    // true = mic ON,     false = mic muted
```

> Send both `video` and `audio` together every time either one changes.  
> The server broadcasts the **same event name** back to everyone else — one listener covers both states.

---

## 4. Received Event Payload Types

### `active_group_calls`
```
calls: ActiveCall[]
```

### `group_call_incoming`
```
callerId:        string
conversationId:  string
callType:        "video" | "audio"
callerInfo:      CallerInfo
conversationInfo: ConversationInfo
```

### `group_call_started`
```
conversationId:  string
conversationInfo: ConversationInfo
```

### `group_call_ended`
```
conversationId: string
```

### `group_call_error`
```
message: string
```

### `newProducer`
```
producerId:      string
kind:            "audio" | "video"
socketId:        string
participantInfo: ParticipantInfo | undefined
```

### `media_state_change` *(received from others)*
```
video:          boolean        // true = camera ON,  false = camera OFF
audio:          boolean        // true = mic ON,     false = muted
conversationId: string         // which room this came from
socketId:       string         // socket of the person who changed state
userInfo: {
  userId: string
  name:   string
  avatar: string | null        // full URL or null
}
```

### `participantLeft`
```
socketId: string
```

### `online-users`
```
string[]   // array of userId strings currently online
```

---

## 5. Shared Object Shapes

### `ActiveCall`
```ts
{
  conversationId:  string
  conversationInfo: ConversationInfo
  participantCount: number           // people currently in the call
}
```

### `ConversationInfo`
```ts
{
  id:     string
  name:   string
  avatar: string | null              // full URL — null if no image set
}
```

### `CallerInfo`
```ts
{
  id:     number                     // integer user ID
  name:   string
  avatar: string | null              // full URL — null if no image set
}
```

### `ParticipantInfo`
```ts
{
  userId: string
  name:   string
  avatar: string | null              // full URL — null if no image set
}
```

### `Producer` *(from `getProducers` response)*
```ts
{
  id:              string            // mediasoup producer ID
  kind:            "audio" | "video"
  socketId:        string
  participantInfo: ParticipantInfo | undefined
}
```

---

## 6. Event Flow at a Glance

```
ACTION                   YOU EMIT                 YOU RECEIVE
─────────────────────────────────────────────────────────────────
App opens / connect  →   join(userId)          ←  active_group_calls (if calls exist)
                                               ←  online-users

Someone starts call  ←                         ←  group_call_incoming
                                               ←  group_call_started

You start a call     →   group_call_initiate
You join the room    →   createRoom ⇄          ←  rtpCapabilities (ack)
                     →   createTransport x2 ⇄  ←  transport params (ack)
                     →   connectTransport ⇄    ←  success (ack)
                     →   produce (audio) ⇄     ←  producer id (ack)
                     →   produce (video) ⇄     ←  producer id (ack)
                     →   getProducers ⇄        ←  producers[] (ack)
                     →   consume (each) ⇄      ←  consumer params (ack)
                     →   resumeConsumer ⇄      ←  success (ack)

New person joins     ←                         ←  newProducer
                     →   consume ⇄             ←  consumer params (ack)
                     →   resumeConsumer ⇄      ←  success (ack)

Toggle camera/mic    →   media_state_change({ video, audio })
                     ←                         ←  media_state_change (to others, same event name)

Someone else toggles ←                         ←  media_state_change

Someone leaves       ←                         ←  participantLeft
Last person leaves   ←                         ←  group_call_ended

You leave            →   leaveRoom
                     ←                         ←  participantLeft (to others)
```

---

## 7. Error Responses

All `⇄` (ack) events return `{ error: string }` on failure. Always check before using the response.

```js
socket.emit('createRoom', { roomId }, (res) => {
  if (res.error) {
    console.error(res.error);
    return;
  }
  // safe to use res.rtpCapabilities
});
```

| Event | Possible error values |
|---|---|
| `createRoom` | `"roomId required"`, `"Join first with your user ID"`, `"You are not in this group"` |
| `createTransport` | `"Participant not found"` |
| `connectTransport` | `"Participant not found"`, `"Transport not found"` |
| `produce` | `"Participant not found"`, `"Transport not found"` |
| `consume` | `"Participant not found"`, `"Producer not found"`, `"Cannot consume own producer"`, `"RTP capabilities mismatch"`, `"Receive transport not found"` |
| `resumeConsumer` | `"Participant not found"`, `"Consumer not found"` |
| `get_active_calls` | `"Not joined"`, `"Invalid user id"` |
| `media_state_change` (emit) | *(silently ignored if not in a room — no error returned)* |
| `group_call_error` event | `"You are not in this group"`, `"Invalid caller id"` |
