# Socket.IO Real-Time Implementation Guide

This guide explains how to implement real-time features in your frontend application using the Socket.IO client.

## Table of Contents
- [Connection Setup](#connection-setup)
- [Socket Events](#socket-events)
- [Implementation Examples](#implementation-examples)
- [Best Practices](#best-practices)

---

## Connection Setup

### Initialize Socket Connection

```javascript
import { io } from 'socket.io-client';

// Replace with your actual backend URL
const socket = io('http://localhost:4002', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});
```

---

## Socket Events

### 1. **Client Emits (Frontend → Backend)**

#### `join` - User connects to socket
```javascript
socket.emit('join', userId);
```
**When to use:** When the user logs in or when the app initializes

---

#### `join_conversation` - Join a conversation room
```javascript
socket.emit('join_conversation', { 
  conversationId: 'conv-123',
  userId: currentUserId 
});
```
**When to use:** When the user opens a conversation/chat

---

#### `leave_conversation` - Leave a conversation room
```javascript
socket.emit('leave_conversation', { 
  conversationId: 'conv-123',
  userId: currentUserId 
});
```
**When to use:** When the user closes/leaves a conversation

---

#### `typing` - User is typing
```javascript
socket.emit('typing', {
  conversationId: 'conv-123',
  userId: currentUserId,
  userName: currentUserName
});
```
**When to use:** When the user starts typing in the input field

**Debounce Recommendation:** Wait 300ms of continuous typing before emitting

---

#### `stop_typing` - User stopped typing
```javascript
socket.emit('stop_typing', {
  conversationId: 'conv-123',
  userId: currentUserId,
  userName: currentUserName
});
```
**When to use:** When the user stops typing (use a 1-2 second timeout)

---

#### `message_read` - Mark message as read (optional)
```javascript
socket.emit('message_read', {
  conversationId: 'conv-123',
  messageId: 'msg-456',
  userId: currentUserId
});
```
**When to use:** When the user reads a message (can be used for read receipts)

---

### 2. **Server Emits (Backend → Frontend)**

#### `online-users` - List of online users
```javascript
socket.on('online-users', (onlineUserIds) => {
  console.log('Online users:', onlineUserIds);
  // Example: ['123', '456', '789']
  // Update your UI to show online status
});
```
**When received:** When any user connects or disconnects

---

#### `new_message` - New message received
```javascript
socket.on('new_message', (response) => {
  // response structure:
  // {
  //   success: true,
  //   message: "Message sent successfully",
  //   data: {
  //     id: "msg-id",
  //     text: "Hello",
  //     userId: 123,
  //     conversationId: "conv-123",
  //     user: {
  //       id: 123,
  //       name: "John",
  //       email: "john@example.com",
  //       avatar: "avatar-url"
  //     },
  //     createdAt: "2024-01-01T00:00:00.000Z"
  //   }
  // }
  
  if (response.success && response.data) {
    // Add the new message to your messages list
    addMessageToConversation(response.data);
  }
});
```
**When received:** When someone sends a message to a conversation you're in

**Note:** The sender also receives this event, so make sure not to add the message twice if you're already adding it from the API response.

---

#### `user_typing` - Someone is typing
```javascript
socket.on('user_typing', (data) => {
  // data structure:
  // {
  //   conversationId: 'conv-123',
  //   userId: 123,
  //   userName: 'John',
  //   isTyping: true
  // }
  
  if (data.userId !== currentUserId) {
    showTypingIndicator(data.userName, data.conversationId);
  }
});
```
**When received:** When someone in the conversation is typing

---

#### `user_stop_typing` - Someone stopped typing
```javascript
socket.on('user_stop_typing', (data) => {
  // data structure:
  // {
  //   conversationId: 'conv-123',
  //   userId: 123,
  //   userName: 'John',
  //   isTyping: false
  // }
  
  hideTypingIndicator(data.conversationId);
});
```
**When received:** When someone in the conversation stops typing

---

#### `user_joined_conversation` - User joined conversation
```javascript
socket.on('user_joined_conversation', (data) => {
  // data: { conversationId, userId }
  console.log(`User ${data.userId} joined conversation ${data.conversationId}`);
  // Update participant list or notification
});
```
**When received:** When someone joins the conversation room

---

#### `user_left_conversation` - User left conversation
```javascript
socket.on('user_left_conversation', (data) => {
  // data: { conversationId, userId }
  console.log(`User ${data.userId} left conversation ${data.conversationId}`);
  // Update participant list
});
```
**When received:** When someone leaves the conversation room

---

#### `messages_marked_read` - Messages marked as read
```javascript
socket.on('messages_marked_read', (data) => {
  // data structure:
  // {
  //   conversationId: 'conv-123',
  //   userId: 123,
  //   markedCount: 5,
  //   messageIds: ['msg1', 'msg2', ...]
  // }
  
  // Update read status of messages in your UI
  updateMessagesReadStatus(data.messageIds, data.userId);
});
```
**When received:** When messages in a conversation are marked as read

---

## Implementation Examples

### Complete React Example

```javascript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function ChatApp() {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const currentUserId = '123';
  const currentUserName = 'John Doe';

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io('http://localhost:4002');
    setSocket(newSocket);

    // Join as user
    newSocket.emit('join', currentUserId);

    // Listen for online users
    newSocket.on('online-users', (userIds) => {
      setOnlineUsers(userIds);
    });

    // Cleanup on unmount
    return () => {
      newSocket.emit('leave_conversation', { 
        conversationId: currentConversationId,
        userId: currentUserId 
      });
      newSocket.close();
    };
  }, []);

  // Join conversation when conversationId changes
  useEffect(() => {
    if (socket && currentConversationId) {
      socket.emit('join_conversation', { 
        conversationId: currentConversationId,
        userId: currentUserId 
      });

      // Listen for new messages in this conversation
      socket.on('new_message', (response) => {
        if (response.data?.conversationId === currentConversationId) {
          setMessages(prev => [...prev, response.data]);
        }
      });

      // Listen for typing indicators
      socket.on('user_typing', (data) => {
        if (data.conversationId === currentConversationId) {
          setTypingUsers(prev => ({
            ...prev,
            [data.userId]: data.userName
          }));
        }
      });

      socket.on('user_stop_typing', (data) => {
        if (data.conversationId === currentConversationId) {
          setTypingUsers(prev => {
            const newTyping = { ...prev };
            delete newTyping[data.userId];
            return newTyping;
          });
        }
      });

      // Cleanup when leaving conversation
      return () => {
        if (socket) {
          socket.emit('leave_conversation', { 
            conversationId: currentConversationId,
            userId: currentUserId 
          });
        }
      };
    }
  }, [socket, currentConversationId]);

  // Handle typing with debounce
  const handleTyping = debounce(() => {
    if (socket && currentConversationId) {
      socket.emit('typing', {
        conversationId: currentConversationId,
        userId: currentUserId,
        userName: currentUserName
      });

      // Stop typing after 2 seconds
      setTimeout(() => {
        socket.emit('stop_typing', {
          conversationId: currentConversationId,
          userId: currentUserId,
          userName: currentUserName
        });
      }, 2000);
    }
  }, 300);

  const sendMessage = (text) => {
    // Call your API to send message
    fetch('/api/v1/messages/send', {
      method: 'POST',
      body: JSON.stringify({ conversationId, userId: currentUserId, text })
    })
    .then(res => res.json())
    .then(data => {
      // Message is already added via socket event
      // or you can add it here from the response
    });
  };

  return (
    <div>
      {/* Your chat UI here */}
      <div className="online-users">
        {onlineUsers.map(userId => (
          <span key={userId}>User {userId} is online</span>
        ))}
      </div>
      
      {messages.map(msg => (
        <div key={msg.id}>{msg.text}</div>
      ))}
      
      {Object.values(typingUsers).length > 0 && (
        <div className="typing-indicator">
          {Object.values(typingUsers).join(', ')} is typing...
        </div>
      )}
    </div>
  );
}

// Simple debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
```

---

## Best Practices

### 1. **Connection Management**
- Connect to socket when the user logs in
- Disconnect when the user logs out
- Reconnect automatically (handled by socket.io-client)

### 2. **Room Management**
- Join conversation rooms only when viewing that conversation
- Leave conversation rooms when leaving/navigating away
- Don't join rooms you don't need (saves bandwidth and processing)

### 3. **Typing Indicators**
- Debounce the `typing` event emission (wait 300ms of continuous typing)
- Automatically emit `stop_typing` after 2-3 seconds of inactivity
- Clear the indicator when the user sends the message

### 4. **Message Handling**
- Listen for `new_message` events in conversations you're viewing
- Handle duplicate messages (sender might receive it via socket and API response)
- Update UI optimistically, then sync with server state

### 5. **Error Handling**
```javascript
socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

socket.on('reconnect', (attemptNumber) => {
  console.log('Reconnected after', attemptNumber, 'attempts');
  // Rejoin all necessary rooms
});
```

### 6. **Performance**
- Only subscribe to events you need
- Clean up event listeners when components unmount
- Use socket.off() to remove listeners before adding new ones

### 7. **Testing**
- Test with multiple tabs/users to verify real-time behavior
- Test reconnection scenarios (disable network temporarily)
- Verify that typing indicators don't spam the socket

---

## API Endpoints Reference

### Send Message
**POST** `/api/v1/messages/send`
```json
{
  "conversationId": "conv-123",
  "userId": 123,
  "text": "Hello world"
}
```

### Get Messages
**GET** `/api/v1/messages/get-messages/:conversationId?myId=123&page=1&limit=10`

### Mark Messages as Read
**PATCH** `/api/v1/messages/mark-as-read/:conversationId`
```json
{
  "myId": 123
}
```

---

## Troubleshooting

### Messages not appearing in real-time
1. Check if you've joined the conversation room
2. Verify the conversationId is correct
3. Check browser console for socket errors
4. Ensure socket connection is established

### Typing indicators not working
1. Make sure you're emitting to the correct conversationId
2. Check if the receiver is in the same conversation room
3. Verify the event names match exactly

### Online users not updating
1. Verify the `join` event is emitted with the correct userId
2. Check if the socket is connected
3. Look for errors in server logs

---

## Support

For questions or issues, contact the backend team or refer to the Socket.IO documentation: https://socket.io/docs/v4/
