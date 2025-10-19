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
import { v4 as uuidv4 } from "uuid";
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

    //check user 2 is exis

    const otherUser = await prisma.user.findUnique({
      where: {
        id: otherUserId,
      },
      select: { id: true, name: true },
    });

    if (!otherUser) {
      return reply.status(404).send({
        success: false,
        message: "Other user not found",
      });
    }

    if (myId === otherUserId) {
      return reply.status(400).send({
        success: false,
        message: "Cannot create conversation with yourself",
      });
    }

    // check it's exis or not
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          {
            members: {
              some: {
                userId: myId,
              },
            },
          },
          {
            members: {
              some: {
                userId: otherUserId,
              },
            },
          },
        ],
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
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (existingConversation) {
      return reply.status(200).send({
        success: true,
        message: "Conversation already exists",
        data: {
          conversation: existingConversation,
        },
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        isGroup: false,
        members: {
          create: [{ userId: myId }, { userId: otherUserId }],
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
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    return reply.status(201).send({
      success: true,
      message: "Conversation created successfully",
      data: {
        conversation,
      },
    });

    //it's a one to one chat not grup chat
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to create chat",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
