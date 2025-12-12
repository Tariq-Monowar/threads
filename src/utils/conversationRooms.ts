export type ConversationRoomsMap = Map<string, Set<string>>;

export const createConversationRoomsStore = () => {
  const conversationRooms: ConversationRoomsMap = new Map();

  const joinConversationRoom = (userId: string, conversationId: string) => {
    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
    }
    const room = conversationRooms.get(conversationId)!;
    room.add(userId);
  };

  const leaveConversationRoom = (userId: string, conversationId: string) => {
    const room = conversationRooms.get(conversationId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        conversationRooms.delete(conversationId);
      }
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
    return room ? Array.from(room) : [];
  };

  return {
    conversationRooms,
    joinConversationRoom,
    leaveConversationRoom,
    isUserInConversationRoom,
    getUsersInConversationRoom,
  };
};

