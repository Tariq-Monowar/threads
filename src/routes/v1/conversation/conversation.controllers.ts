import { FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcrypt";
import {
  forgotPasswordEmail,
  otpVerificationEmail,
  sendForgotPasswordOTP,
  sendTwoFactorOtp,
} from "../../../utils/email.config";

import { generateJwtToken } from "../../../utils/jwt.utils";
import { getImageUrl } from "../../../utils/baseurl";
import path from "path";
import fs from "fs";

import { authenticator } from "otplib";
import { uploadsDir } from "../../../config/storage.config";

export const createConversation = async (request, reply) => {
  try {
    const { otherUserId, myId } = request.body;
    const prisma = request.server.prisma;

    const missingField = ["otherUserId", "myId"].find(
      (field) => !request.body[field]
    );

    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    const otherUserIdInt = parseInt(otherUserId);
    const myIdInt = parseInt(myId);

    // Check if conversation exists
    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: myIdInt } } },
          { members: { some: { userId: otherUserIdInt } } },
        ],
      },
      include: {
        members: { include: { user: true } },
      },
    });

    if (existing) {
      return reply.send({ success: true, data: existing });
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        isGroup: false,
        members: {
          create: [{ userId: myIdInt }, { userId: otherUserIdInt }],
        },
      },
      include: {
        members: { include: { user: true } },
      },
    });

    return reply.send({ success: true, data: conversation });
  } catch (error) {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to create chat" });
  }
};

export const getMyConversationsList = async (request, reply) => {
  try {
    const { myId } = request.params;
    const prisma = request.server.prisma;

    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: {
            userId: parseInt(myId),
          },
        },
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return reply.send({ success: true, data: conversations });
  } catch (error) {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to get conversations" });
  }
};

export const createGroupChat = async (request, reply) => {
  try {
    const { name, userIds, adminId, avatar } = request.body;
    const prisma = request.server.prisma;

    const adminIdInt = parseInt(adminId);
    const userIdsInt = userIds.map((id) => parseInt(id));

    if (!userIds || userIds.length < 2) {
      return reply.status(400).send({
        success: false,
        message: "Group name and at least 2 users are required",
      });
    }

    // Check if all users exist
    const users = await prisma.user.findMany({
      where: {
        id: { in: [...userIdsInt, adminIdInt] },
      },
    });

    if (users.length !== userIdsInt.length + 1) {
      return reply.status(404).send({
        success: false,
        message: "Some users not found",
      });
    }

    // Create group conversation with admin
    const conversation = await prisma.conversation.create({
      data: {
        name,
        isGroup: true,
        avatar,
        adminId: adminIdInt,
        members: {
          create: [
            { userId: adminIdInt, isAdmin: true },
            ...userIdsInt.map((userId) => ({
              userId,
              isAdmin: false,
            })),
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
        admin: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return reply.send({
      success: true,
      message: "Group chat created successfully",
      data: conversation,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to create group chat",
    });
  }
};

export const updateGroupPermissions = async (request, reply) => {
  try {
    const {
      conversationId,
      adminId,
      allowMemberAdd,
      allowMemberMessage,
      allowEditGroupInfo,
    } = request.body;
    const prisma = request.server.prisma;

    const missingField = ["conversationId", "adminId"].find(
      (field) => !request.body[field]
    );

    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    const isAdmin = await prisma.conversationMember.findFirst({
      where: {
        conversationId: conversationId,
        userId: parseInt(adminId),
        isAdmin: true,
      },
    });

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only group admin can update permissions",
      });
    }

    // Build update object only with provided boolean fields
    const allowedFields = [
      "allowMemberAdd",
      "allowMemberMessage",
      "allowEditGroupInfo",
    ];

    const data = Object.fromEntries(
      allowedFields
        .filter((field) => typeof request.body[field] === "boolean")
        .map((field) => [field, request.body[field]])
    );

    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        allowMemberAdd,
        allowMemberMessage,
        allowEditGroupInfo,
      },
    });

    return reply.send({
      success: true,
      message: "Permissions updated",
      data: updatedConversation,
    });
  } catch (error) {
    return reply.status(500).send({
      success: false,
      message: "Failed to update permissions",
    });
  }
};

export const addUsersToGroup = async (request, reply) => {
  try {
    const { userIds, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const missingField = ["userIds", "adminId"].find(
      (field) => !request.body[field]
    );

    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    if (!conversationId) {
      return reply.status(400).send({
        success: false,
        message: `conversation Id is required!`,
      });
    }

    const adminIdInt = parseInt(adminId);
    const userIdsInt = userIds.map((id) => parseInt(id));

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    const userMember = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: adminIdInt,
      },
    });

    const isAdmin = userMember?.isAdmin;
    const canAddMembers = isAdmin || conversation.allowMemberAdd;

    if (!canAddMembers) {
      return reply.status(403).send({
        success: false,
        message: "You don't have permission to add users",
      });
    }

    // Check if new users exist
    const users = await prisma.user.findMany({
      where: { id: { in: userIdsInt } },
    });

    if (users.length !== userIdsInt.length) {
      return reply.status(404).send({
        success: false,
        message: "Some users not found",
      });
    }

    const existingMembers = await prisma.conversationMember.findMany({
      where: {
        conversationId,
        userId: { in: userIdsInt },
      },
    });

    if (existingMembers.length > 0) {
      const existingUserIds = existingMembers.map((member) => member.userId);
      return reply.status(400).send({
        success: false,
        message: `Users already in group: ${existingUserIds.join(", ")}`,
      });
    }

    await prisma.conversationMember.createMany({
      data: userIdsInt.map((userId) => ({
        userId,
        conversationId,
        isAdmin: false,
      })),
    });

    // Get updated conversation
    const updatedConversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
        admin: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return reply.send({
      success: true,
      message: "Users added successfully",
      data: updatedConversation,
    });
  } catch (error) {
    return reply.status(500).send({
      success: false,
      message: "Failed to add users",
    });
  }
};


export const removeUsersFromGroup = async (request, reply) => {
  try {
    const { userIds, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    const missingField = ["userIds", "adminId"].find(
      (field) => !request.body[field]
    );

    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    if (!conversationId) {
      return reply.status(400).send({
        success: false,
        message: `conversation Id is required!`,
      });
    }

    const adminIdInt = parseInt(adminId);
    const userIdsInt = userIds.map((id) => parseInt(id));

    // Check if conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { 
        id: conversationId, 
        isGroup: true 
      },
      include: {
        members: true
      }
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify that the requester is the admin
    const isAdmin = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: adminIdInt,
        isAdmin: true,
      },
    });

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only group admin can remove users",
      });
    }

    // Prevent admin from removing themselves
    if (userIdsInt.includes(adminIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Admin cannot remove themselves from the group",
      });
    }

    // Check if users to remove are actually in the group
    const existingMembers = await prisma.conversationMember.findMany({
      where: {
        conversationId,
        userId: { in: userIdsInt },
      },
    });

    if (existingMembers.length === 0) {
      return reply.status(404).send({
        success: false,
        message: "No specified users found in the group",
      });
    }

    const existingUserIds = existingMembers.map((member) => member.userId);
    
    // Check if all specified users exist in the group
    const nonExistingUsers = userIdsInt.filter(
      (userId) => !existingUserIds.includes(userId)
    );

    if (nonExistingUsers.length > 0) {
      return reply.status(404).send({
        success: false,
        message: `Some users not found in group: ${nonExistingUsers.join(", ")}`,
      });
    }

    // Remove users from the group
    await prisma.conversationMember.deleteMany({
      where: {
        conversationId,
        userId: { in: userIdsInt },
      },
    });

    // Get updated conversation
    const updatedConversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
        admin: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return reply.send({
      success: true,
      message: "Users removed successfully",
      data: updatedConversation,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to remove users from group",
    });
  }
};