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

  const leaveConversationRoom = (userId: string, conversationId: string): boolean => {
    const room = conversationRooms.get(conversationId);
    if (room) {
      const wasInRoom = room.has(userId);
      if (wasInRoom) {
        room.delete(userId);
        if (room.size === 0) {
          conversationRooms.delete(conversationId);
        }
        return true;
      }
      return false;
    }
    return false;
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
