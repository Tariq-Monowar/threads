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

export const deleteMessage = async (request, reply) => {
  try {
    const { messageId } = request.params;
    const { myId } = request.body;
    const prisma = request.server.prisma;

    if (!messageId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "messageId and myId are required!",
      });
    }

    const myIdInt = parseInt(myId);

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        userId: myIdInt,
      },
    });

    if (!message) {
      return reply.status(404).send({
        success: false,
        message: "Message not found or you don't have permission to delete it",
      });
    }

    await prisma.message.delete({
      where: {
        id: messageId,
      },
    });

    return reply.send({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to delete message",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const sendMessage = async (request, reply) => {
  try {
    const { conversationId, userId, text } = request.body;
    const prisma = request.server.prisma;

    const missingField = ["conversationId", "userId", "text"].find(
      (field) => !request.body[field]
    );

    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    const userIdInt = parseInt(userId);

    const transactionResult = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          members: {
            some: {
              userId: userIdInt,
              isDeleted: false,
            },
          },
        },
      });

      if (!conversation) {
        throw new Error(
          "Conversation not found or you don't have access to it"
        );
      }

      const [message, members] = await Promise.all([
        tx.message.create({
          data: {
            text,
            userId: userIdInt,
            conversationId,
          },
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
        }),
        tx.conversationMember.findMany({
          where: {
            conversationId,
            isDeleted: false,
          },
          select: {
            userId: true,
          },
        }),
        tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        }),
      ]);

      return { message, members };
    });

    const response = {
      success: true,
      message: "Message sent successfully",
      data: transactionResult.message,
    };

    // Emit to all conversation members (exclude sender)
    transactionResult.members
      .filter((member) => member.userId !== userIdInt)
      .forEach((member) => {
        if (member.userId) {
          request.server.io.to(member.userId.toString()).emit("new_message", response);
        }
      });

    return reply.status(201).send(response);
  } catch (error) {
    request.log.error(error);

    if (
      error.message === "Conversation not found or you don't have access to it"
    ) {
      return reply.status(404).send({
        success: false,
        message: error.message,
      });
    }

    return reply.status(500).send({
      success: false,
      message: "Failed to send message",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const deleteMessageForMe = async (request, reply) => {
  try {
    const { messageId } = request.params;
    const { myId } = request.body;
    const prisma = request.server.prisma;

    if (!messageId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "messageId and myId are required!",
      });
    }

    const myIdInt = parseInt(myId);

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
      },
    });

    if (!message) {
      return reply.status(404).send({
        success: false,
        message: "Message not found",
      });
    }

    const conversationMember = await prisma.conversationMember.findFirst({
      where: {
        conversationId: message.conversationId,
        userId: myIdInt,
        isDeleted: false,
      },
    });

    if (!conversationMember) {
      return reply.status(403).send({
        success: false,
        message: "You don't have access to this conversation",
      });
    }

    const existingDeletion = await prisma.messageDeletion.findFirst({
      where: {
        messageId,
        userId: myIdInt,
      },
    });

    if (existingDeletion) {
      return reply.status(400).send({
        success: false,
        message: "Message already deleted for you",
      });
    }

    await prisma.messageDeletion.create({
      data: {
        messageId,
        userId: myIdInt,
      },
    });

    return reply.send({
      success: true,
      message: "Message deleted for you",
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to delete message",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const deleteMessageForEveryone = async (request, reply) => {
  try {
    const { messageId } = request.params;
    const { myId } = request.body;
    const prisma = request.server.prisma;

    if (!messageId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "messageId and myId are required!",
      });
    }

    const myIdInt = parseInt(myId);

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        userId: myIdInt,
      },
    });

    if (!message) {
      return reply.status(404).send({
        success: false,
        message: "Message not found or you don't have permission to delete it",
      });
    }

    if (message.isDeletedForEveryone) {
      return reply.status(400).send({
        success: false,
        message: "Message already deleted for everyone",
      });
    }

    await prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        // isDeletedForEveryone: true,
        // deletedForEveryoneAt: new Date(),
        text: "Message is deleted",
      },
    });

    return reply.send({
      success: true,
      message: "Message deleted for everyone",
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to delete message",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const markMultipleMessagesAsRead = async (request, reply) => {
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

    const unreadMessages = await prisma.message.findMany({
      where: {
        conversationId,
        isRead: false,
        isDeletedForEveryone: false,
      },
      select: {
        id: true,
      },
    });

    if (unreadMessages.length === 0) {
      return reply.send({
        success: true,
        message: "All messages already marked as read",
        data: {
          markedCount: 0,
          totalUnreadMessages: 0,
        },
      });
    }

    const [result, members] = await Promise.all([
      prisma.message.updateMany({
        where: {
          conversationId,
          isRead: false,
          isDeletedForEveryone: false,
        },
        data: {
          isRead: true,
        },
      }),
      prisma.conversationMember.findMany({
        where: {
          conversationId,
          isDeleted: false,
        },
        select: {
          userId: true,
        },
      }),
    ]);

    // Emit read receipts to all conversation members (exclude sender)
    members
      .filter((member) => member.userId !== myIdInt)
      .forEach((member) => {
        if (member.userId) {
          request.server.io.to(member.userId.toString()).emit("messages_marked_read", {
            conversationId,
            userId: myIdInt,
            markedCount: result.count,
            messageIds: unreadMessages.map(m => m.id)
          });
        }
      });

    return reply.send({
      success: true,
      message: "Messages marked as read",
      data: {
        markedCount: result.count,
        totalUnreadMessages: unreadMessages.length,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to mark messages as read",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getMessages = async (request, reply) => {
  try {
    const { conversationId } = request.params;
    const { myId, page = 1, limit = 10 } = request.query;
    const prisma = request.server.prisma;

    if (!conversationId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and myId are required!",
      });
    }

    const pageInt = Math.max(parseInt(page.toString()) || 1, 1);
    const limitInt = Math.min(
      Math.max(parseInt(limit.toString()) || 10, 1),
      100
    );
    const offset = (pageInt - 1) * limitInt;

    const myIdInt = parseInt(myId);

    const conversationMember = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: myIdInt,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (!conversationMember) {
      return reply.status(403).send({
        success: false,
        message: "You don't have access to this conversation",
      });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        isDeletedForEveryone: false,
        deletedForMe: {
          none: {
            userId: myIdInt,
          },
        },
      },
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
      orderBy: {
        createdAt: "desc",
      },
      skip: offset,
      take: limitInt + 1,
    });

    const hasMore = messages.length > limitInt;
    const actualMessages = hasMore ? messages.slice(0, limitInt) : messages;
    const hasNextPage = hasMore;
    const hasPrevPage = pageInt > 1;

    return reply.send({
      success: true,
      data: actualMessages,
      pagination: {
        currentPage: pageInt,
        itemsPerPage: limitInt,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to get messages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
