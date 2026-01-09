"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCall = exports.getCallDetails = exports.getCallHistory = void 0;
const baseurl_1 = require("../../../utils/baseurl");
const fileService_1 = require("../../../utils/fileService");
const jsonArray_1 = require("../../../utils/jsonArray");
const getCallHistory = async (request, reply) => {
    try {
        const { userId } = request.params;
        const { page = "1", limit = "20", type, status } = request.query;
        if (!userId) {
            return reply.status(400).send({
                success: false,
                message: "userId is required",
            });
        }
        const userIdInt = parseInt(userId);
        if (Number.isNaN(userIdInt)) {
            return reply.status(400).send({
                success: false,
                message: "Invalid userId",
            });
        }
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;
        const prisma = request.server.prisma;
        const whereClause = {
            OR: [{ callerId: userIdInt }, { receiverId: userIdInt }],
        };
        if (type) {
            whereClause.type = type;
        }
        if (status) {
            whereClause.status = status;
        }
        // Fetch all calls first, then filter out deleted ones in code
        // MySQL JSON doesn't support { has: ... } filter, so we filter after fetching
        const allCalls = await prisma.call.findMany({
            where: whereClause,
            select: {
                id: true,
                callerId: true,
                receiverId: true,
                type: true,
                status: true,
                startedAt: true,
                endedAt: true,
                participantIds: true,
                deletedForUsers: true,
                caller: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                    },
                },
                receiver: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                    },
                },
                conversation: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                        isGroup: true,
                    },
                },
            },
            orderBy: {
                startedAt: "desc",
            },
        });
        // Filter out calls deleted for this user
        const calls = allCalls.filter((call) => {
            return !(0, jsonArray_1.jsonArrayContains)(call.deletedForUsers, userIdInt);
        });
        // Get total count (including deleted ones for accurate pagination)
        const allCallsForCount = await prisma.call.findMany({
            where: whereClause,
            select: { id: true, deletedForUsers: true },
        });
        const totalCount = allCallsForCount.filter((call) => {
            return !(0, jsonArray_1.jsonArrayContains)(call.deletedForUsers, userIdInt);
        }).length;
        // Apply pagination after filtering
        const paginatedCalls = calls.slice(skip, skip + limitNum);
        const formattedCalls = paginatedCalls.map((call) => {
            const isCaller = call.callerId === userIdInt;
            const otherUser = isCaller ? call.receiver : call.caller;
            return {
                id: call.id,
                type: call.type,
                status: call.status,
                startedAt: call.startedAt,
                endedAt: call.endedAt,
                duration: call.endedAt && call.startedAt
                    ? Math.floor((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
                    : null,
                isOutgoing: isCaller,
                // otherUser: {
                //   id: otherUser?.id,
                //   name: otherUser?.name,
                //   avatar: otherUser?.avatar ? `${getImageUrl(otherUser.avatar)}` : null,
                // },
                caller: {
                    id: call.caller.id,
                    name: call.caller.name,
                    // avatar should with base url
                    avatar: call.caller.avatar
                        ? `${fileService_1.FileService.avatarUrl(call.caller.avatar)}`
                        : null,
                },
                receiver: {
                    id: call.receiver.id,
                    name: call.receiver.name,
                    avatar: call.receiver.avatar
                        ? `${fileService_1.FileService.avatarUrl(call.receiver.avatar)}`
                        : null,
                },
                conversation: call.conversation,
                participantIds: call.participantIds,
            };
        });
        return reply.send({
            success: true,
            data: {
                calls: formattedCalls,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    totalPages: Math.ceil(totalCount / limitNum),
                },
            },
        });
    }
    catch (error) {
        request.log.error(error);
        return reply.status(500).send({
            success: false,
            message: "Failed to fetch call history",
            error: error.message,
        });
    }
};
exports.getCallHistory = getCallHistory;
const getCallDetails = async (request, reply) => {
    try {
        const { callId } = request.params;
        const { userId } = request.query;
        if (!callId) {
            return reply.status(400).send({
                success: false,
                message: "callId is required",
            });
        }
        if (!userId) {
            return reply.status(400).send({
                success: false,
                message: "userId is required",
            });
        }
        const userIdInt = parseInt(userId);
        if (Number.isNaN(userIdInt)) {
            return reply.status(400).send({
                success: false,
                message: "Invalid userId",
            });
        }
        const prisma = request.server.prisma;
        const call = await prisma.call.findUnique({
            where: { id: callId },
            select: {
                id: true,
                callerId: true,
                receiverId: true,
                type: true,
                status: true,
                startedAt: true,
                endedAt: true,
                participantIds: true,
                deletedForUsers: true,
                caller: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                    },
                },
                receiver: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                    },
                },
                conversation: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                        isGroup: true,
                    },
                },
            },
        });
        if (!call) {
            return reply.status(404).send({
                success: false,
                message: "Call not found",
            });
        }
        // Check if call is deleted for this user
        const callData = call;
        if ((0, jsonArray_1.jsonArrayContains)(callData.deletedForUsers, userIdInt)) {
            return reply.status(404).send({
                success: false,
                message: "Call not found",
            });
        }
        const duration = callData.endedAt && callData.startedAt
            ? Math.floor((callData.endedAt.getTime() - callData.startedAt.getTime()) / 1000)
            : null;
        return reply.send({
            success: true,
            data: {
                id: callData.id,
                type: callData.type,
                status: callData.status,
                startedAt: callData.startedAt,
                endedAt: callData.endedAt,
                duration,
                caller: {
                    id: callData.caller.id,
                    name: callData.caller.name,
                    avatar: callData.caller.avatar
                        ? `${(0, baseurl_1.getImageUrl)(callData.caller.avatar)}`
                        : null,
                },
                receiver: {
                    id: callData.receiver.id,
                    name: callData.receiver.name,
                    avatar: callData.receiver.avatar
                        ? `${(0, baseurl_1.getImageUrl)(callData.receiver.avatar)}`
                        : null,
                },
                conversation: callData.conversation,
                participantIds: callData.participantIds,
            },
        });
    }
    catch (error) {
        request.log.error(error);
        return reply.status(500).send({
            success: false,
            message: "Failed to fetch call details",
            error: error.message,
        });
    }
};
exports.getCallDetails = getCallDetails;
//delete a array of call ids - soft delete (only for the requesting user)
const deleteCall = async (request, reply) => {
    try {
        const { callIds, userId } = request.body;
        console.log("===============", callIds, userId);
        if (!callIds || !Array.isArray(callIds) || callIds.length === 0) {
            return reply.status(400).send({
                success: false,
                message: "callIds array is required",
            });
        }
        if (!userId) {
            return reply.status(400).send({
                success: false,
                message: "userId is required",
            });
        }
        const userIdInt = parseInt(userId);
        if (Number.isNaN(userIdInt)) {
            return reply.status(400).send({
                success: false,
                message: "Invalid userId",
            });
        }
        const prisma = request.server.prisma;
        // Fetch all calls to check ownership and update
        const calls = await prisma.call.findMany({
            where: {
                id: { in: callIds },
                OR: [{ callerId: userIdInt }, { receiverId: userIdInt }],
            },
            select: {
                id: true,
                deletedForUsers: true,
            },
        });
        if (calls.length === 0) {
            return reply.status(404).send({
                success: false,
                message: "No calls found or you don't have permission to delete them",
            });
        }
        // Update each call to add userId to deletedForUsers
        const updatePromises = calls.map(async (call) => {
            // Check if already deleted for this user
            if ((0, jsonArray_1.jsonArrayContains)(call.deletedForUsers, userIdInt)) {
                return call.id; // Already deleted, skip
            }
            // Add userId to deletedForUsers
            const updatedDeletedForUsers = (0, jsonArray_1.jsonArrayAdd)(call.deletedForUsers, userIdInt);
            await prisma.call.update({
                where: { id: call.id },
                data: {
                    deletedForUsers: updatedDeletedForUsers,
                },
            });
            return call.id;
        });
        const deletedCallIds = await Promise.all(updatePromises);
        return reply.send({
            success: true,
            message: "Call history deleted successfully",
            data: {
                callIds: deletedCallIds.filter(Boolean),
            },
        });
    }
    catch (error) {
        request.log.error(error);
        return reply.status(500).send({
            success: false,
            message: "Failed to delete call",
            error: error.message,
        });
    }
};
exports.deleteCall = deleteCall;
//# sourceMappingURL=calls.controllers.js.map