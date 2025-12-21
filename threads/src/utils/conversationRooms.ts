export type ConversationRoomsMap = Map<string, Set<string>>;

export const createConversationRoomsStore = () => {
  console.log("\n🚀 [CONVERSATION ROOMS STORE INITIALIZED]\n");
  const conversationRooms: ConversationRoomsMap = new Map();

  const joinConversationRoom = (userId: string, conversationId: string) => {
    // Use process.stdout.write for more reliable output
    process.stdout.write(`\n🔵 [JOIN ROOM] User: ${userId}, Conversation: ${conversationId}\n`);
    console.log("🔵 [JOIN ROOM FUNCTION CALLED]", { userId, conversationId });
    
    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
      process.stdout.write(`[Join Room] ✅ Created new room for conversation ${conversationId}\n`);
    }
    const room = conversationRooms.get(conversationId)!;
    const wasAlreadyInRoom = room.has(userId);
    room.add(userId);
    
    const usersInRoom = Array.from(room);
    process.stdout.write(`[Join Room] User ${userId} ${wasAlreadyInRoom ? 'already in' : 'joined'} conversation ${conversationId}\n`);
    process.stdout.write(`[Join Room] Total users: ${room.size}, Users: [${usersInRoom.join(", ")}]\n\n`);
    console.log(`[Join Room] State:`, { 
      conversationId, 
      userId, 
      wasAlreadyInRoom, 
      roomSize: room.size, 
      usersInRoom 
    });
  };

  const leaveConversationRoom = (userId: string, conversationId: string): boolean => {
    // Use process.stdout.write for more reliable output
    process.stdout.write(`\n🔴 [LEAVE ROOM] User: ${userId}, Conversation: ${conversationId}\n`);
    console.log("🔴 [LEAVE ROOM FUNCTION CALLED]", { userId, conversationId });
    
    const room = conversationRooms.get(conversationId);
    if (room) {
      const wasInRoom = room.has(userId);
      const roomSizeBefore = room.size;
      const usersBefore = Array.from(room);
      
      process.stdout.write(`[Leave Room] Room exists: ✅, User was in room: ${wasInRoom ? 'YES' : 'NO'}, Size before: ${roomSizeBefore}\n`);
      
      if (wasInRoom) {
        room.delete(userId);
        const roomSizeAfter = room.size;
        const usersAfter = Array.from(room);
        
        process.stdout.write(`[Leave Room] ✅ User ${userId} REMOVED from conversation ${conversationId}\n`);
        process.stdout.write(`[Leave Room] Room size: ${roomSizeBefore} → ${roomSizeAfter}\n`);
        
        if (room.size === 0) {
          conversationRooms.delete(conversationId);
          process.stdout.write(`[Leave Room] 🗑️ Room ${conversationId} DELETED (empty)\n\n`);
        } else {
          process.stdout.write(`[Leave Room] Remaining users: [${usersAfter.join(", ")}]\n\n`);
        }
        
        console.log(`[Leave Room] Success:`, { 
          userId, 
          conversationId, 
          wasInRoom, 
          roomSizeBefore, 
          roomSizeAfter,
          usersBefore,
          usersAfter,
          roomDeleted: room.size === 0
        });
        return true;
      } else {
        process.stdout.write(`[Leave Room] ⚠️ User ${userId} was NOT in room ${conversationId}\n`);
        process.stdout.write(`[Leave Room] Current users: [${usersBefore.join(", ")}]\n\n`);
        console.log(`[Leave Room] User not in room:`, { userId, conversationId, usersBefore });
        return false;
      }
    } else {
      const availableRooms = Array.from(conversationRooms.keys());
      process.stdout.write(`[Leave Room] ❌ Room ${conversationId} does NOT exist\n`);
      process.stdout.write(`[Leave Room] Available rooms: [${availableRooms.join(", ")}]\n\n`);
      console.log(`[Leave Room] Room not found:`, { conversationId, availableRooms });
      return false;
    }
  };

  const isUserInConversationRoom = (
    userId: string,
    conversationId: string
  ): boolean => {
    const room = conversationRooms.get(conversationId);
    if (!room) {
      return false;
    }
    return room.has(userId);
  };

  const getUsersInConversationRoom = (conversationId: string): string[] => {
    const room = conversationRooms.get(conversationId);
    const users = room ? Array.from(room) : [];
    
    // Only log if there are users to avoid spam
    if (users.length > 0) {
      process.stdout.write(`🟡 [GET ROOM] Conversation: ${conversationId}, Users: [${users.join(", ")}], Size: ${room?.size || 0}\n`);
    }
    console.log("🟡 [GET USERS IN ROOM]", { conversationId, roomExists: !!room, roomSize: room?.size || 0, users });
    
    return users;
  };
  
  // Debug function to get all rooms state
  const debugGetAllRooms = () => {
    const allRooms: Record<string, string[]> = {};
    conversationRooms.forEach((users, conversationId) => {
      allRooms[conversationId] = Array.from(users);
    });
    return allRooms;
  };

  return {
    conversationRooms,
    joinConversationRoom,
    leaveConversationRoom,
    isUserInConversationRoom,
    getUsersInConversationRoom,
    debugGetAllRooms,
  };
};

