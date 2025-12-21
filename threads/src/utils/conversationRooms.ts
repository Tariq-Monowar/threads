export type ConversationRoomsMap = Map<string, Set<string>>;

export const createConversationRoomsStore = () => {
  console.log("\n🚀 [CONVERSATION ROOMS STORE INITIALIZED]\n");
  const conversationRooms: ConversationRoomsMap = new Map();

  const joinConversationRoom = (userId: string, conversationId: string) => {
    console.log("========================================");
    console.log("🔵 [JOIN ROOM FUNCTION CALLED]");
    console.log(`   User ID: ${userId}`);
    console.log(`   Conversation ID: ${conversationId}`);
    console.log("========================================");
    
    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
      console.log(`[Join Room] ✅ Created new room for conversation ${conversationId}`);
    }
    const room = conversationRooms.get(conversationId)!;
    const wasAlreadyInRoom = room.has(userId);
    room.add(userId);
    
    console.log(`[Join Room] User ${userId} ${wasAlreadyInRoom ? 'already in' : 'joined'} conversation ${conversationId}`);
    console.log(`[Join Room] Total users in room now: ${room.size}`);
    console.log(`[Join Room] Users in room: [${Array.from(room).join(", ")}]`);
    console.log("========================================\n");
  };

  const leaveConversationRoom = (userId: string, conversationId: string): boolean => {
    console.log("========================================");
    console.log("🔴 [LEAVE ROOM FUNCTION CALLED]");
    console.log(`   User ID: ${userId}`);
    console.log(`   Conversation ID: ${conversationId}`);
    console.log("========================================");
    
    const room = conversationRooms.get(conversationId);
    if (room) {
      const wasInRoom = room.has(userId);
      const roomSizeBefore = room.size;
      
      console.log(`[Leave Room] Room exists: ✅`);
      console.log(`[Leave Room] User was in room: ${wasInRoom ? '✅ YES' : '❌ NO'}`);
      console.log(`[Leave Room] Room size before: ${roomSizeBefore}`);
      
      if (wasInRoom) {
        room.delete(userId);
        console.log(`[Leave Room] ✅ User ${userId} removed from conversation ${conversationId}`);
        console.log(`[Leave Room] Room size after: ${room.size}`);
        
        if (room.size === 0) {
          conversationRooms.delete(conversationId);
          console.log(`[Leave Room] 🗑️ Room ${conversationId} is now empty - deleted`);
        } else {
          console.log(`[Leave Room] Remaining users in room: [${Array.from(room).join(", ")}]`);
        }
        console.log("========================================\n");
        return true;
      } else {
        console.log(`[Leave Room] ⚠️ User ${userId} was NOT in room ${conversationId}`);
        console.log(`[Leave Room] Current users in room: [${Array.from(room).join(", ")}]`);
        console.log("========================================\n");
        return false;
      }
    } else {
      console.log(`[Leave Room] ❌ Room ${conversationId} does NOT exist`);
      console.log(`[Leave Room] Available rooms: [${Array.from(conversationRooms.keys()).join(", ")}]`);
      console.log("========================================\n");
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
    
    console.log("========================================");
    console.log("🟡 [GET USERS IN ROOM FUNCTION CALLED]");
    console.log(`   Conversation ID: ${conversationId}`);
    console.log(`   Room exists: ${!!room ? '✅ YES' : '❌ NO'}`);
    console.log(`   Room size: ${room?.size || 0}`);
    console.log(`   Users in room: [${users.join(", ")}]`);
    console.log("========================================\n");
    
    return users;
  };

  return {
    conversationRooms,
    joinConversationRoom,
    leaveConversationRoom,
    isUserInConversationRoom,
    getUsersInConversationRoom,
  };
};

