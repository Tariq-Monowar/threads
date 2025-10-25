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

export const getMyConversationsList = async (request, reply) => {
  try {
    const { myId } = request.params;
    const prisma = request.server.prisma;

    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: {
            userId: parseInt(myId),
            isDeleted: false, // Only show non-deleted conversations
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
