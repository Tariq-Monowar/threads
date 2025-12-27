"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConversationRoomsStore = void 0;
const createConversationRoomsStore = () => {
    console.log("\n🚀 [CONVERSATION ROOMS STORE INITIALIZED]\n");
    const conversationRooms = new Map();
    const joinConversationRoom = (userId, conversationId) => {
        try {
            // Force immediate output with multiple methods
            console.error(`\n🔵🔵🔵 [JOIN ROOM FUNCTION CALLED] 🔵🔵🔵`);
            console.error(`User ID: ${userId}, Conversation ID: ${conversationId}`);
            process.stdout.write(`\n🔵 [JOIN ROOM] User: ${userId}, Conversation: ${conversationId}\n`);
            process.stderr.write(`[JOIN ROOM] User: ${userId}, Conversation: ${conversationId}\n`);
            if (!conversationRooms.has(conversationId)) {
                conversationRooms.set(conversationId, new Set());
                console.error(`[Join Room] ✅ Created new room for conversation ${conversationId}`);
                process.stdout.write(`[Join Room] ✅ Created new room for conversation ${conversationId}\n`);
            }
            const room = conversationRooms.get(conversationId);
            const wasAlreadyInRoom = room.has(userId);
            room.add(userId);
            const usersInRoom = Array.from(room);
            console.error(`[Join Room] User ${userId} ${wasAlreadyInRoom ? 'already in' : 'joined'} conversation ${conversationId}`);
            console.error(`[Join Room] Total users: ${room.size}, Users: [${usersInRoom.join(", ")}]`);
            process.stdout.write(`[Join Room] User ${userId} ${wasAlreadyInRoom ? 'already in' : 'joined'} conversation ${conversationId}\n`);
            process.stdout.write(`[Join Room] Total users: ${room.size}, Users: [${usersInRoom.join(", ")}]\n\n`);
            // Verify it worked
            const verifyRoom = conversationRooms.get(conversationId);
            const verifyHasUser = verifyRoom?.has(userId);
            console.error(`[Join Room] VERIFICATION: Room exists=${!!verifyRoom}, User in room=${verifyHasUser}, Room size=${verifyRoom?.size}`);
        }
        catch (error) {
            console.error(`[Join Room] ❌ ERROR:`, error);
            process.stderr.write(`[Join Room] ERROR: ${error?.message || error}\n`);
            throw error;
        }
    };
    const leaveConversationRoom = (userId, conversationId) => {
        try {
            // Force immediate output with multiple methods
            console.error(`\n🔴🔴🔴 [LEAVE ROOM FUNCTION CALLED] 🔴🔴🔴`);
            console.error(`User ID: ${userId}, Conversation ID: ${conversationId}`);
            process.stdout.write(`\n🔴 [LEAVE ROOM] User: ${userId}, Conversation: ${conversationId}\n`);
            process.stderr.write(`[LEAVE ROOM] User: ${userId}, Conversation: ${conversationId}\n`);
            const room = conversationRooms.get(conversationId);
            if (room) {
                const wasInRoom = room.has(userId);
                const roomSizeBefore = room.size;
                const usersBefore = Array.from(room);
                console.error(`[Leave Room] Room exists: ✅, User was in room: ${wasInRoom ? 'YES' : 'NO'}, Size before: ${roomSizeBefore}`);
                process.stdout.write(`[Leave Room] Room exists: ✅, User was in room: ${wasInRoom ? 'YES' : 'NO'}, Size before: ${roomSizeBefore}\n`);
                if (wasInRoom) {
                    room.delete(userId);
                    const roomSizeAfter = room.size;
                    const usersAfter = Array.from(room);
                    console.error(`[Leave Room] ✅ User ${userId} REMOVED from conversation ${conversationId}`);
                    console.error(`[Leave Room] Room size: ${roomSizeBefore} → ${roomSizeAfter}`);
                    process.stdout.write(`[Leave Room] ✅ User ${userId} REMOVED from conversation ${conversationId}\n`);
                    process.stdout.write(`[Leave Room] Room size: ${roomSizeBefore} → ${roomSizeAfter}\n`);
                    if (room.size === 0) {
                        conversationRooms.delete(conversationId);
                        console.error(`[Leave Room] 🗑️ Room ${conversationId} DELETED (empty)`);
                        process.stdout.write(`[Leave Room] 🗑️ Room ${conversationId} DELETED (empty)\n\n`);
                    }
                    else {
                        console.error(`[Leave Room] Remaining users: [${usersAfter.join(", ")}]`);
                        process.stdout.write(`[Leave Room] Remaining users: [${usersAfter.join(", ")}]\n\n`);
                    }
                    // Verify it worked
                    const verifyRoom = conversationRooms.get(conversationId);
                    const verifyHasUser = verifyRoom?.has(userId);
                    console.error(`[Leave Room] VERIFICATION: Room exists=${!!verifyRoom}, User in room=${verifyHasUser}, Room size=${verifyRoom?.size || 0}`);
                    return true;
                }
                else {
                    console.error(`[Leave Room] ⚠️ User ${userId} was NOT in room ${conversationId}`);
                    console.error(`[Leave Room] Current users: [${usersBefore.join(", ")}]`);
                    process.stdout.write(`[Leave Room] ⚠️ User ${userId} was NOT in room ${conversationId}\n`);
                    process.stdout.write(`[Leave Room] Current users: [${usersBefore.join(", ")}]\n\n`);
                    return false;
                }
            }
            else {
                const availableRooms = Array.from(conversationRooms.keys());
                console.error(`[Leave Room] ❌ Room ${conversationId} does NOT exist`);
                console.error(`[Leave Room] Available rooms: [${availableRooms.join(", ")}]`);
                process.stdout.write(`[Leave Room] ❌ Room ${conversationId} does NOT exist\n`);
                process.stdout.write(`[Leave Room] Available rooms: [${availableRooms.join(", ")}]\n\n`);
                return false;
            }
        }
        catch (error) {
            console.error(`[Leave Room] ❌ ERROR:`, error);
            process.stderr.write(`[Leave Room] ERROR: ${error?.message || error}\n`);
            throw error;
        }
    };
    const isUserInConversationRoom = (userId, conversationId) => {
        const room = conversationRooms.get(conversationId);
        if (!room) {
            return false;
        }
        return room.has(userId);
    };
    const getUsersInConversationRoom = (conversationId) => {
        try {
            const room = conversationRooms.get(conversationId);
            const users = room ? Array.from(room) : [];
            // Log every call for debugging
            console.error(`🟡 [GET ROOM] Conversation: ${conversationId}, Room exists: ${!!room}, Size: ${room?.size || 0}, Users: [${users.join(", ")}]`);
            if (users.length > 0) {
                process.stdout.write(`🟡 [GET ROOM] Conversation: ${conversationId}, Users: [${users.join(", ")}], Size: ${room?.size || 0}\n`);
            }
            return users;
        }
        catch (error) {
            console.error(`[Get Room] ❌ ERROR:`, error);
            return [];
        }
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
        debugGetAllRooms,
    };
};
exports.createConversationRoomsStore = createConversationRoomsStore;
//# sourceMappingURL=conversationRooms.js.map