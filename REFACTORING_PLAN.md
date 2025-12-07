# Socket Plugin Refactoring Plan
## ফাইল স্ট্রাকচার এবং বিস্তারিত বিবরণ

---

## 📁 প্রস্তাবিত ফাইল স্ট্রাকচার

```
src/plugins/socket/
├── index.ts                          # Main plugin entry point
├── config/
│   └── socket.config.ts              # Socket.io server configuration
├── types/
│   └── socket.types.ts               # TypeScript types and interfaces
├── state/
│   ├── user.state.ts                 # Online users state management
│   ├── call.state.ts                 # Active calls state management
│   ├── conversation.state.ts         # Conversation rooms state management
│   └── ice.state.ts                  # ICE candidate buffering state
├── helpers/
│   ├── conversation.helpers.ts       # Conversation room helper functions
│   ├── ice.helpers.ts                # ICE candidate helper functions
│   └── call-history.helpers.ts       # Call history database operations
├── handlers/
│   ├── connection.handler.ts         # Socket connection setup
│   ├── user.handler.ts               # User join/online events
│   ├── typing.handler.ts             # Typing indicators
│   ├── conversation.handler.ts       # Conversation room events
│   ├── call.handler.ts               # Call initiation/accept/decline/end
│   └── webrtc.handler.ts             # WebRTC offer/answer/ICE events
└── utils/
    └── socket.utils.ts               # General socket utility functions
```

---

## 📄 প্রতিটি ফাইলের বিস্তারিত বিবরণ

### 1. `src/plugins/socket/index.ts`
**উদ্দেশ্য:** Main plugin entry point - Fastify plugin registration

**কী থাকবে:**
- Fastify plugin wrapper (`fp`)
- Socket.io server initialization (config থেকে import)
- সব state management import এবং initialize
- সব event handlers register করা
- Fastify instance decoration (io, onlineUsers, activeCalls, etc.)
- TypeScript module declaration

**Import করবে:**
- `config/socket.config.ts` থেকে socket server config
- সব `state/*` files থেকে state managers
- সব `handlers/*` files থেকে event handlers

---

### 2. `src/plugins/socket/config/socket.config.ts`
**উদ্দেশ্য:** Socket.io server configuration

**কী থাকবে:**
- CORS configuration (origins, methods, credentials)
- Socket.io Server options
- Server instance creation function

**কোড:**
```typescript
export const getSocketConfig = () => ({
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:50468",
      "http://localhost:4002",
      "http://127.0.0.1:5500",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

export const createSocketServer = (server: any) => {
  return new Server(server, getSocketConfig());
};
```

---

### 3. `src/plugins/socket/types/socket.types.ts`
**উদ্দেশ্য:** সব TypeScript types, interfaces, enums

**কী থাকবে:**
- `CallType` type: "audio" | "video"
- `CallStatus` type: "calling" | "in_call"
- `CallData` interface
- `ICECandidateBuffer` interface
- Fastify instance decoration types
- Event payload types (call_initiate, webrtc_offer, etc.)

**কোড:**
```typescript
export type CallType = "audio" | "video";
export type CallStatus = "calling" | "in_call";

export interface CallData {
  with: string;
  status: CallStatus;
  type: CallType;
}

export interface ICECandidateBuffer {
  candidate: RTCIceCandidate;
  timestamp: number;
}

// Event payload types
export interface CallInitiatePayload {
  callerId: string;
  receiverId: string;
  callType?: CallType;
  callerName?: string;
  callerAvatar?: string;
}

// ... আরো types
```

---

### 4. `src/plugins/socket/state/user.state.ts`
**উদ্দেশ্য:** Online users state management

**কী থাকবে:**
- `onlineUsers` Map: `Map<string, Set<string>>` (userId -> socketIds)
- Functions:
  - `addUserSocket(userId, socketId)`: Add socket to user
  - `removeUserSocket(userId, socketId)`: Remove socket from user
  - `getUserSockets(userId)`: Get all sockets for a user
  - `isUserOnline(userId)`: Check if user has any active sockets
  - `getAllOnlineUsers()`: Get array of all online user IDs
  - `removeUser(userId)`: Remove user completely

**Export:**
- `onlineUsers` Map (singleton)
- সব helper functions

---

### 5. `src/plugins/socket/state/call.state.ts`
**উদ্দেশ্য:** Active calls state management

**কী থাকবে:**
- `activeCalls` Map: `Map<string, CallData>` (userId -> CallData)
- `callHistoryMap` Map: `Map<string, string>` (callKey -> callId)
- Functions:
  - `setActiveCall(userId, callData)`: Set active call
  - `getActiveCall(userId)`: Get active call data
  - `removeActiveCall(userId)`: Remove active call
  - `hasActiveCall(userId)`: Check if user has active call
  - `setCallHistory(callKey, callId)`: Store call history ID
  - `getCallHistory(callKey)`: Get call history ID
  - `removeCallHistory(callKey)`: Remove call history

**Export:**
- `activeCalls` Map
- `callHistoryMap` Map
- সব helper functions

---

### 6. `src/plugins/socket/state/conversation.state.ts`
**উদ্দেশ্য:** Conversation rooms state management

**কী থাকবে:**
- `conversationRooms` Map: `Map<string, Set<string>>` (conversationId -> userIds)
- Functions:
  - `joinConversationRoom(userId, conversationId)`: Add user to room
  - `leaveConversationRoom(userId, conversationId)`: Remove user from room
  - `isUserInConversationRoom(userId, conversationId)`: Check if user in room
  - `getUsersInConversationRoom(conversationId)`: Get all users in room
  - `removeConversationRoom(conversationId)`: Remove empty room

**Export:**
- `conversationRooms` Map
- সব helper functions

---

### 7. `src/plugins/socket/state/ice.state.ts`
**উদ্দেশ্য:** ICE candidate buffering state management

**কী থাকবে:**
- `iceCandidateBuffers` Map: `Map<string, ICECandidateBuffer[]>` (key -> buffers)
- Functions:
  - `getIceCandidateBuffer(userId, peerId)`: Get or create buffer
  - `clearIceCandidateBuffer(userId, peerId)`: Clear buffer for both directions
  - `cleanupOldIceCandidates()`: Remove candidates older than 30 seconds
  - `startIceCleanupInterval()`: Start periodic cleanup (every 10 seconds)

**Export:**
- `iceCandidateBuffers` Map
- সব helper functions
- Cleanup interval starter

---

### 8. `src/plugins/socket/helpers/conversation.helpers.ts`
**উদ্দেশ্য:** Conversation room helper functions (database operations)

**কী থাকবে:**
- `markMessagesAsReadOnJoin(fastify, userId, conversationId, io)`: 
  - Mark messages from other members as read when user joins
  - Emit read status to other members
  - Async operation (uses setImmediate)

**Export:**
- `markMessagesAsReadOnJoin` function

---

### 9. `src/plugins/socket/helpers/ice.helpers.ts`
**উদ্দেশ্য:** ICE candidate helper functions

**কী থাকবে:**
- `shouldBufferIceCandidate(callStatus)`: Check if should buffer
- `flushIceCandidates(io, userId, peerId, socket)`: Send buffered candidates
- Helper functions for ICE candidate management

**Export:**
- সব ICE helper functions

---

### 10. `src/plugins/socket/helpers/call-history.helpers.ts`
**উদ্দেশ্য:** Call history database operations

**কী থাকবে:**
- `saveCallHistory(fastify, callerId, receiverId, type, status, conversationId?, startedAt?, endedAt?)`: 
  - Create call record in database
  - Return callId or null
- `updateCallHistory(fastify, callId, status, endedAt?)`: 
  - Update call status and end time
  - Handle errors gracefully

**Export:**
- `saveCallHistory` function
- `updateCallHistory` function

---

### 11. `src/plugins/socket/handlers/connection.handler.ts`
**উদ্দেশ্য:** Socket connection setup and initialization

**কী থাকবে:**
- `setupConnectionHandlers(io, socket, fastify)`: 
  - Main connection handler
  - Register all event handlers
  - Setup getUserId helper
  - Handle disconnect

**Export:**
- `setupConnectionHandlers` function

**Import করবে:**
- সব handler files (user, typing, conversation, call, webrtc)
- সব state managers

---

### 12. `src/plugins/socket/handlers/user.handler.ts`
**উদ্দেশ্য:** User join and online status events

**কী থাকবে:**
- `handleUserJoin(io, socket, fastify, userId)`: 
  - Handle "join" event
  - Add user to onlineUsers
  - Emit online-users to all
- `handleGetOnlineUsers(socket)`: 
  - Handle "get_online_users" event
  - Emit current online users list

**Export:**
- `handleUserJoin` function
- `handleGetOnlineUsers` function

**Import করবে:**
- `state/user.state.ts` থেকে onlineUsers

---

### 13. `src/plugins/socket/handlers/typing.handler.ts`
**উদ্দেশ্য:** Typing indicator events

**কী থাকবে:**
- `handleStartTyping(io, socket, fastify, payload)`: 
  - Handle "start_typing" event
  - Validate user is in conversation room
  - Emit to all room members except sender
- `handleStopTyping(io, socket, fastify, payload)`: 
  - Handle "stop_typing" event
  - Validate user is in conversation room
  - Emit to all room members except sender

**Export:**
- `handleStartTyping` function
- `handleStopTyping` function

**Import করবে:**
- `state/conversation.state.ts` থেকে conversation room functions

---

### 14. `src/plugins/socket/handlers/conversation.handler.ts`
**উদ্দেশ্য:** Conversation room events

**কী থাকবে:**
- `handleJoinConversation(io, socket, fastify, payload)`: 
  - Handle "join_conversation" event
  - Add user to conversation room
  - Join socket room
  - Mark messages as read (async)
  - Emit confirmation
- `handleLeaveConversation(io, socket, fastify, payload)`: 
  - Handle "leave_conversation" event
  - Remove user from conversation room
  - Leave socket room
  - Emit confirmation

**Export:**
- `handleJoinConversation` function
- `handleLeaveConversation` function

**Import করবে:**
- `state/conversation.state.ts`
- `state/user.state.ts`
- `helpers/conversation.helpers.ts`

---

### 15. `src/plugins/socket/handlers/call.handler.ts`
**উদ্দেশ্য:** Call events (initiate, accept, decline, end)

**কী থাকবে:**
- `handleCallInitiate(io, socket, fastify, payload)`: 
  - Handle "call_initiate" event
  - Validate users
  - Check if receiver is busy
  - Fetch user data from database
  - Send FCM push notifications
  - Set active calls
  - Save call history
  - Clear ICE buffers
  - Emit call_incoming to receiver
- `handleCallAccept(io, socket, fastify, payload)`: 
  - Handle "call_accept" event
  - Update call status to "in_call"
  - Update call history
  - Emit call_accepted to caller
- `handleCallDecline(io, socket, fastify, payload)`: 
  - Handle "call_decline" event
  - Remove active calls
  - Clear ICE buffers
  - Update call history to DECLINED
  - Emit call_declined to caller
- `handleCallEnd(io, socket, fastify, payload)`: 
  - Handle "call_end" event
  - Remove active calls
  - Clear ICE buffers
  - Update call history (COMPLETED or CANCELED)
  - Send FCM push notification
  - Emit call_ended to opponent

**Export:**
- `handleCallInitiate` function
- `handleCallAccept` function
- `handleCallDecline` function
- `handleCallEnd` function

**Import করবে:**
- `state/call.state.ts`
- `state/user.state.ts`
- `state/ice.state.ts`
- `helpers/call-history.helpers.ts`
- Prisma client
- FileService

---

### 16. `src/plugins/socket/handlers/webrtc.handler.ts`
**উদ্দেশ্য:** WebRTC signaling events

**কী থাকবে:**
- `handleWebRTCOffer(io, socket, fastify, payload)`: 
  - Handle "webrtc_offer" event
  - Clear old ICE buffers
  - Emit offer to receiver
- `handleWebRTCAnswer(io, socket, fastify, payload)`: 
  - Handle "webrtc_answer" event
  - Emit answer to caller
  - Flush buffered ICE candidates
- `handleWebRTCICE(io, socket, fastify, payload)`: 
  - Handle "webrtc_ice" event
  - Validate active call
  - Buffer or send ICE candidate based on call status
- `handleWebRTCICEFlush(io, socket, fastify, payload)`: 
  - Handle "webrtc_ice_flush" event
  - Send all buffered ICE candidates
  - Clear buffer

**Export:**
- `handleWebRTCOffer` function
- `handleWebRTCAnswer` function
- `handleWebRTCICE` function
- `handleWebRTCICEFlush` function

**Import করবে:**
- `state/call.state.ts`
- `state/user.state.ts`
- `state/ice.state.ts`
- `helpers/ice.helpers.ts`

---

### 17. `src/plugins/socket/utils/socket.utils.ts`
**উদ্দেশ্য:** General socket utility functions

**কী থাকবে:**
- `getUserIdFromSocket(socket, onlineUsers)`: 
  - Extract userId from socket using onlineUsers map
  - Return userId or null
- `emitToUser(io, userId, event, data)`: 
  - Emit event to all sockets of a user
- `validateCallParticipants(callerId, receiverId)`: 
  - Validate user IDs are numeric
  - Return validation result

**Export:**
- সব utility functions

---

## 🔄 Import/Export Flow

```
index.ts
  ├── config/socket.config.ts (Server setup)
  ├── types/socket.types.ts (Types)
  ├── state/*.ts (State managers)
  └── handlers/connection.handler.ts
        ├── handlers/user.handler.ts
        ├── handlers/typing.handler.ts
        ├── handlers/conversation.handler.ts
        ├── handlers/call.handler.ts
        └── handlers/webrtc.handler.ts
              └── helpers/*.ts (Helper functions)
```

---

## ✅ Refactoring Benefits

1. **Maintainability**: প্রতিটি ফাইল একটি specific responsibility handle করে
2. **Testability**: প্রতিটি module আলাদা করে test করা যায়
3. **Readability**: কোড খুঁজে পাওয়া সহজ
4. **Scalability**: নতুন features যোগ করা সহজ
5. **Reusability**: Helper functions অন্য জায়গায় reuse করা যায়

---

## 📝 Implementation Notes

- **No Response Changes**: সব event responses একই থাকবে
- **State Management**: সব state singleton pattern এ থাকবে
- **Error Handling**: প্রতিটি handler এ proper error handling
- **Logging**: Fastify logger ব্যবহার করা হবে
- **Type Safety**: সব functions properly typed হবে

---

## 🚀 Next Steps

1. Create folder structure
2. Move types to `types/socket.types.ts`
3. Extract state management to separate files
4. Extract helpers to separate files
5. Extract handlers to separate files
6. Update main `index.ts` to import and wire everything
7. Test all functionality
