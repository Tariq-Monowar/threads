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

    const activeConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: myIdInt, isDeleted: false } } },
          { members: { some: { userId: otherUserIdInt, isDeleted: false } } },
        ],
      },
      include: {
        members: { include: { user: true } },
      },
    });

    if (activeConversation) {
      const messages = await prisma.message.findMany({
        where: { conversationId: activeConversation.id },
        take: 50,
        orderBy: { createdAt: "asc" },
      });

      return reply.send({
        success: true,
        data: {
          ...activeConversation,
          messages,
        },
      });
    }

    const deletedConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: myIdInt, isDeleted: true } } },
          { members: { some: { userId: otherUserIdInt } } },
        ],
      },
    });

    if (deletedConversation) {
      const newConversation = await prisma.conversation.create({
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

      return reply.send({
        success: true,
        data: {
          ...newConversation,
          messages: [],
        },
        message: "New conversation created (previous conversation was deleted)",
      });
    }

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

    return reply.send({
      success: true,
      data: {
        ...conversation,
        messages: [],
      },
    });
  } catch (error) {
    console.error("Error creating conversation:", error);
    return reply
      .status(500)
      .send({ success: false, message: "Failed to create chat" });
  }
};

export const deleteConversationForMe = async (request, reply) => {
  try {
    const { conversationId } = request.params;
    const { myId } = request.body;
    const prisma = request.server.prisma;

    if (!conversationId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and myId are required!",
      });
    }

    const myIdInt = parseInt(myId);

    await prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: myIdInt,
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return reply.send({
      success: true,
      message: "Conversation deleted successfully",
    });
  } catch (error) {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to delete conversation" });
  }
};
