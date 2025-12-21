export type ConversationRoomsMap = Map<string, Set<string>>;

export const createConversationRoomsStore = () => {
  const conversationRooms: ConversationRoomsMap = new Map();

  const joinConversationRoom = (userId: string, conversationId: string) => {
    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
      console.log(`[Join Room] Created new room for conversation ${conversationId}`);
    }
    const room = conversationRooms.get(conversationId)!;
    room.add(userId);
    console.log(`[Join Room] User ${userId} joined conversation ${conversationId}`);
    console.log(`[Join Room] Total users in room now: ${room.size}`, Array.from(room));
  };

  const leaveConversationRoom = (userId: string, conversationId: string) => {
    const room = conversationRooms.get(conversationId);
    if (room) {
      const wasInRoom = room.has(userId);
      room.delete(userId);
      
      console.log(`[Leave Room] User ${userId} leaving conversation ${conversationId}`);
      console.log(`[Leave Room] Was in room: ${wasInRoom}, Room size before: ${room.size + 1}, Room size after: ${room.size}`);
      
      if (room.size === 0) {
        conversationRooms.delete(conversationId);
        console.log(`[Leave Room] Room ${conversationId} is now empty - deleted`);
      } else {
        console.log(`[Leave Room] Remaining users in room:`, Array.from(room));
      }
    } else {
      console.log(`[Leave Room] Room ${conversationId} does not exist`);
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
    console.log(`[Get Room] Conversation ${conversationId} has ${users.length} users:`, users);
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

