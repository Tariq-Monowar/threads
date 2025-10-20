import { FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcrypt";
import {
  forgotPasswordEmail,
  otpVerificationEmail,
  sendForgotPasswordOTP,
  sendTwoFactorOtp,
} from "../../../../utils/email.config";

import { generateJwtToken } from "../../../../utils/jwt.utils";
import { getImageUrl } from "../../../../utils/baseurl";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { authenticator } from "otplib";
import { uploadsDir } from "../../../../config/storage.config";

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
              isAdmin: false 
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
