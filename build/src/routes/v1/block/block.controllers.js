"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBlockList = exports.unblockUser = exports.blockUser = void 0;
const fileService_1 = require("../../../utils/fileService");
const blockUser = async (request, reply) => {
    const prisma = request.server.prisma;
    try {
        const myId = Number(request.body.myId);
        const otherId = Number(request.body.otherId);
        if (!myId || !otherId) {
            return reply.status(400).send({
                success: false,
                message: "myId and otherId are required",
            });
        }
        if (myId === otherId) {
            return reply.status(400).send({
                success: false,
                message: "You cannot block yourself",
            });
        }
        // Check if both users exist
        const users = await prisma.user.findMany({
            where: {
                id: { in: [myId, otherId] },
            },
            select: { id: true },
        });
        if (users.length !== 2) {
            return reply.status(404).send({
                success: false,
                message: "One or both users not found",
            });
        }
        // Find conversation between the two users (if exists)
        const conversation = await prisma.conversation.findFirst({
            where: {
                isGroup: false,
                AND: [
                    { members: { some: { userId: myId, isDeleted: false } } },
                    { members: { some: { userId: otherId, isDeleted: false } } },
                ],
            },
            select: {
                id: true,
            },
        });
        // block create (unique constraint handles duplicate)
        const block = await prisma.block.create({
            data: {
                blockerId: myId,
                blockedId: otherId,
            },
            include: {
                blocked: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatar: true,
                    },
                },
            },
        });
        const data = {
            conversationId: conversation?.id || null,
            myId: block.blockerId,
            otherId: block.blocked.id,
            name: block.blocked.name,
            email: block.blocked.email,
            avatar: block.blocked.avatar
                ? fileService_1.FileService.avatarUrl(block.blocked.avatar)
                : null,
            createdAt: block.createdAt,
        };
        request.server.io.emit("blockUser", data);
        return reply.status(201).send({
            success: true,
            message: "User blocked",
            data,
        });
    }
    catch (error) {
        // already blocked (unique constraint)
        if (error.code === "P2002") {
            return reply.status(400).send({
                success: false,
                message: "User already blocked",
            });
        }
        // foreign key constraint (user doesn't exist)
        if (error.code === "P2003") {
            return reply.status(404).send({
                success: false,
                message: "One or both users not found",
            });
        }
        request.log.error(error);
        return reply.status(500).send({
            success: false,
            message: "Something went wrong",
        });
    }
};
exports.blockUser = blockUser;
// Unblock a user
const unblockUser = async (request, reply) => {
    try {
        const { myId, otherId } = request.body;
        const prisma = request.server.prisma;
        if (!myId || !otherId) {
            return reply.status(400).send({
                success: false,
                message: "myId and otherId are required!",
            });
        }
        const myIdInt = parseInt(myId);
        const otherIdInt = parseInt(otherId);
        if (isNaN(myIdInt) || isNaN(otherIdInt)) {
            return reply.status(400).send({
                success: false,
                message: "Invalid user IDs!",
            });
        }
        // Check if block exists and get blocked user info
        const existingBlock = await prisma.block.findUnique({
            where: {
                blockerId_blockedId: {
                    blockerId: myIdInt,
                    blockedId: otherIdInt,
                },
            },
            include: {
                blocked: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatar: true,
                    },
                },
            },
        });
        if (!existingBlock) {
            return reply.status(404).send({
                success: false,
                message: "User is not blocked!",
            });
        }
        // Find conversation between the two users (if exists)
        const conversation = await prisma.conversation.findFirst({
            where: {
                isGroup: false,
                AND: [
                    { members: { some: { userId: myIdInt, isDeleted: false } } },
                    { members: { some: { userId: otherIdInt, isDeleted: false } } },
                ],
            },
            select: {
                id: true,
            },
        });
        // Format block data before deleting
        const formattedBlock = {
            conversationId: conversation?.id || null,
            myId: existingBlock.blockerId,
            otherId: existingBlock.blocked.id,
            name: existingBlock.blocked.name,
            email: existingBlock.blocked.email,
            avatar: existingBlock.blocked.avatar
                ? fileService_1.FileService.avatarUrl(existingBlock.blocked.avatar)
                : null,
            createdAt: existingBlock.createdAt,
        };
        // Delete block record
        await prisma.block.delete({
            where: {
                blockerId_blockedId: {
                    blockerId: myIdInt,
                    blockedId: otherIdInt,
                },
            },
        });
        // Send socket event
        request.server.io.emit("unblockUser", formattedBlock);
        return reply.send({
            success: true,
            message: "User unblocked successfully",
            data: formattedBlock,
        });
    }
    catch (error) {
        request.log.error(error);
        return reply.status(500).send({
            success: false,
            message: "Failed to unblock user",
        });
    }
};
exports.unblockUser = unblockUser;
// Get block list for a user
const getBlockList = async (request, reply) => {
    try {
        const { myId } = request.params;
        const { page = 1, limit = 10 } = request.query;
        const prisma = request.server.prisma;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        if (!myId) {
            return reply.status(400).send({
                success: false,
                message: "myId is required!",
            });
        }
        const myIdInt = parseInt(myId);
        if (isNaN(myIdInt)) {
            return reply.status(400).send({
                success: false,
                message: "Invalid user ID!",
            });
        }
        // Get all blocked users
        const blockedUsers = await prisma.block.findMany({
            where: {
                blockerId: myIdInt,
            },
            skip,
            take: limitNum,
            include: {
                blocked: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatar: true,
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });
        const totalCount = await prisma.block.count({
            where: {
                blockerId: myIdInt,
            },
        });
        const totalPages = Math.ceil(totalCount / limitNum);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;
        // Format data similar to formattedBlock
        const data = blockedUsers.map((block) => ({
            myId: block.blockerId,
            otherId: block.blocked.id,
            name: block.blocked.name,
            email: block.blocked.email,
            avatar: block.blocked.avatar
                ? fileService_1.FileService.avatarUrl(block.blocked.avatar)
                : null,
            createdAt: block.createdAt,
        }));
        return reply.status(200).send({
            success: true,
            message: "Block list retrieved successfully",
            data: data,
            pagination: {
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
                currentPage: pageNum,
                perPage: limitNum,
            },
        });
    }
    catch (error) {
        request.log.error(error);
        return reply.status(500).send({
            success: false,
            message: "Failed to get block list",
        });
    }
};
exports.getBlockList = getBlockList;
//# sourceMappingURL=block.controllers.js.map