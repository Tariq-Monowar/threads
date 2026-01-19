export type OnlineUsersMap = Map<string, Set<string>>;

export const createOnlineUsersStore = () => {
  const onlineUsers: OnlineUsersMap = new Map();
  // Reverse map for O(1) socketId -> userId lookup
  const socketToUser: Map<string, string> = new Map();

  const addSocket = (userId: string, socketId: string): number => {
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    const sockets = onlineUsers.get(userId)!;
    sockets.add(socketId);
    socketToUser.set(socketId, userId); // O(1) reverse mapping
    return sockets.size;
  };

  const removeSocket = (userId: string, socketId: string): number => {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return 0;
    sockets.delete(socketId);
    socketToUser.delete(socketId); // O(1) cleanup
    const remaining = sockets.size;
    if (remaining === 0) {
      onlineUsers.delete(userId);
    }
    return remaining;
  };

  const getUserIdBySocket = (socketId: string): string | null => {
    return socketToUser.get(socketId) || null; // O(1) instead of O(n)
  };

  const getSocketsForUser = (userId: string): Set<string> | undefined =>
    onlineUsers.get(userId);

  const getOnlineUserIds = (): string[] => Array.from(onlineUsers.keys());

  return {
    onlineUsers,
    addSocket,
    removeSocket,
    getUserIdBySocket,
    getSocketsForUser,
    getOnlineUserIds,
  };
};

