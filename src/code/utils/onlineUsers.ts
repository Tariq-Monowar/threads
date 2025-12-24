export type OnlineUsersMap = Map<string, Set<string>>;

export const createOnlineUsersStore = () => {
  const onlineUsers: OnlineUsersMap = new Map();

  const addSocket = (userId: string, socketId: string): number => {
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    const sockets = onlineUsers.get(userId)!;
    sockets.add(socketId);
    return sockets.size;
  };

  const removeSocket = (userId: string, socketId: string): number => {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return 0;
    sockets.delete(socketId);
    const remaining = sockets.size;
    if (remaining === 0) {
      onlineUsers.delete(userId);
    }
    return remaining;
  };

  const getUserIdBySocket = (socketId: string): string | null => {
    for (const [userId, sockets] of onlineUsers.entries()) {
      if (sockets.has(socketId)) {
        return userId;
      }
    }
    return null;
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

