"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOnlineUsersStore = void 0;
const createOnlineUsersStore = () => {
    const onlineUsers = new Map();
    // Reverse map for O(1) socketId -> userId lookup
    const socketToUser = new Map();
    const addSocket = (userId, socketId) => {
        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
        }
        const sockets = onlineUsers.get(userId);
        sockets.add(socketId);
        socketToUser.set(socketId, userId); // O(1) reverse mapping
        return sockets.size;
    };
    const removeSocket = (userId, socketId) => {
        const sockets = onlineUsers.get(userId);
        if (!sockets)
            return 0;
        sockets.delete(socketId);
        socketToUser.delete(socketId); // O(1) cleanup
        const remaining = sockets.size;
        if (remaining === 0) {
            onlineUsers.delete(userId);
        }
        return remaining;
    };
    const getUserIdBySocket = (socketId) => {
        return socketToUser.get(socketId) || null; // O(1) instead of O(n)
    };
    const getSocketsForUser = (userId) => onlineUsers.get(userId);
    const getOnlineUserIds = () => Array.from(onlineUsers.keys());
    return {
        onlineUsers,
        addSocket,
        removeSocket,
        getUserIdBySocket,
        getSocketsForUser,
        getOnlineUserIds,
    };
};
exports.createOnlineUsersStore = createOnlineUsersStore;
//# sourceMappingURL=onlineUsers.js.map