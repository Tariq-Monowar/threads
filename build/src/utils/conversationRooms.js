"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConversationRoomsStore = void 0;
const createConversationRoomsStore = () => {
    const conversationRooms = new Map();
    // Reverse map: userId -> Set<conversationId> for O(1) lookup of user's rooms
    const userRooms = new Map();
    const joinConversationRoom = (userId, conversationId) => {
        if (!conversationRooms.has(conversationId)) {
            conversationRooms.set(conversationId, new Set());
        }
        const room = conversationRooms.get(conversationId);
        room.add(userId);
        // Update reverse map
        if (!userRooms.has(userId)) {
            userRooms.set(userId, new Set());
        }
        userRooms.get(userId).add(conversationId);
    };
    const leaveConversationRoom = (userId, conversationId) => {
        const room = conversationRooms.get(conversationId);
        if (room) {
            const wasInRoom = room.has(userId);
            if (wasInRoom) {
                room.delete(userId);
                if (room.size === 0) {
                    conversationRooms.delete(conversationId);
                }
                // Update reverse map
                const userRoomSet = userRooms.get(userId);
                if (userRoomSet) {
                    userRoomSet.delete(conversationId);
                    if (userRoomSet.size === 0) {
                        userRooms.delete(userId);
                    }
                }
                return true;
            }
            return false;
        }
        return false;
    };
    // Get all conversation IDs a user is in - O(1) instead of O(n)
    const getUserConversationRooms = (userId) => {
        const rooms = userRooms.get(userId);
        return rooms ? Array.from(rooms) : [];
    };
    const isUserInConversationRoom = (userId, conversationId) => {
        const room = conversationRooms.get(conversationId);
        if (!room) {
            return false;
        }
        return room.has(userId);
    };
    const getUsersInConversationRoom = (conversationId) => {
        const room = conversationRooms.get(conversationId);
        return room ? Array.from(room) : [];
    };
    // Debug function to get all rooms state
    const debugGetAllRooms = () => {
        const allRooms = {};
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
        getUserConversationRooms,
        debugGetAllRooms,
    };
};
exports.createConversationRoomsStore = createConversationRoomsStore;
//# sourceMappingURL=conversationRooms.js.map