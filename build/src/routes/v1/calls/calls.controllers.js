"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCall = exports.getCallDetails = exports.getCallHistory = void 0;
const baseurl_1 = require("../../../utils/baseurl");
const fileService_1 = require("../../../utils/fileService");
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
        const [calls, totalCount] = await Promise.all([
            prisma.call.findMany({
                where: whereClause,
                include: {
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
                skip,
                take: limitNum,
            }),
            prisma.call.count({
                where: whereClause,
            }),
        ]);
        const formattedCalls = calls.map((call) => {
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
        if (!callId) {
            return reply.status(400).send({
                success: false,
                message: "callId is required",
            });
        }
        const prisma = request.server.prisma;
        const call = await prisma.call.findUnique({
            where: { id: callId },
            include: {
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
        const duration = call.endedAt && call.startedAt
            ? Math.floor((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
            : null;
        return reply.send({
            success: true,
            data: {
                id: call.id,
                type: call.type,
                status: call.status,
                startedAt: call.startedAt,
                endedAt: call.endedAt,
                duration,
                caller: {
                    id: call.caller.id,
                    name: call.caller.name,
                    avatar: call.caller.avatar
                        ? `${(0, baseurl_1.getImageUrl)(call.caller.avatar)}`
                        : null,
                },
                receiver: {
                    id: call.receiver.id,
                    name: call.receiver.name,
                    avatar: call.receiver.avatar
                        ? `${(0, baseurl_1.getImageUrl)(call.receiver.avatar)}`
                        : null,
                },
                conversation: call.conversation,
                participantIds: call.participantIds,
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
//delete a array of call ids
const deleteCall = async (request, reply) => {
    console.log("deleteCall", request.body);
    try {
        const { callIds } = request.body;
        if (!callIds) {
            return reply.status(400).send({
                success: false,
                message: "callIds is required",
            });
        }
        const prisma = request.server.prisma;
        await prisma.call.deleteMany({
            where: {
                id: { in: callIds },
            },
        });
        return reply.send({
            success: true,
            message: "Call deleted successfully",
            data: {
                callIds,
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