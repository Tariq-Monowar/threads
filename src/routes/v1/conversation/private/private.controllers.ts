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

    // Check if there's an active (non-deleted) conversation
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
      // Return existing active conversation
      return reply.send({ success: true, data: activeConversation });
    }

    // Check if there's a deleted conversation for the current user
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
      // Create a completely NEW conversation (fresh start)
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
        data: newConversation,
        message: "New conversation created (previous conversation was deleted)"
      });
    }

    // Create new conversation (no previous conversation exists)
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

// Simple delete conversation for current user only
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

    // Mark conversation as deleted for this user only
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
