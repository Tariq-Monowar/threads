"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOnlineUsersStore = void 0;
const createOnlineUsersStore = () => {
    const onlineUsers = new Map();
    const addSocket = (userId, socketId) => {
        if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
        }
        const sockets = onlineUsers.get(userId);
        sockets.add(socketId);
        return sockets.size;
    };
    const removeSocket = (userId, socketId) => {
        const sockets = onlineUsers.get(userId);
        if (!sockets)
            return 0;
        sockets.delete(socketId);
        const remaining = sockets.size;
        if (remaining === 0) {
            onlineUsers.delete(userId);
        }
        return remaining;
    };
    const getUserIdBySocket = (socketId) => {
        for (const [userId, sockets] of onlineUsers.entries()) {
            if (sockets.has(socketId)) {
                return userId;
            }
        }
        return null;
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