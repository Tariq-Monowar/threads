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
import { FileService } from "../../../utils/fileService";

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

    const files = await prisma.messageFile.findMany({
      where: { messageId },
      select: { fileUrl: true },
    });

    await prisma.$transaction([
      prisma.messageFile.deleteMany({ where: { messageId } }),
      prisma.message.delete({ where: { id: messageId } }),
    ]);

    try {
      const filenames = files.map((f) => f.fileUrl).filter(Boolean);
      if (filenames.length) {
        FileService.removeFiles(filenames);
      }
    } catch (_) {}

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

    const files = (request.files as any[]) || [];

    const uploadedFilenames = files.map((f) => f.filename).filter(Boolean);

    if ((!text || text.trim() === "") && files.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "Either text or at least one file is required!",
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
        select: { id: true },
      });

      if (!conversation) {
        throw new Error(
          "Conversation not found or you don't have access to it"
        );
      }

      const filesCreate = files.length
        ? files.map((file) => ({
            userId: userIdInt,
            fileUrl: file.filename,
            fileType: file.mimetype || null,
            fileSize: typeof file.size === "number" ? file.size : null,
            fileExtension:
              path.extname(file.originalname || "").replace(".", "") || null,
          }))
        : [];

      const [message, members] = await Promise.all([
        tx.message.create({
          data: {
            text: text && text.trim() !== "" ? text : null,
            userId: userIdInt,
            conversationId,
            ...(filesCreate.length
              ? {
                  MessageFile: {
                    create: filesCreate,
                  },
                }
              : {}),
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
            MessageFile: true,
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

    const transformedMessage = {
      ...transactionResult.message,
      MessageFile:
        (transactionResult.message as any)?.MessageFile?.map((f: any) => ({
          ...f,
          fileUrl: f?.fileUrl ? getImageUrl(f.fileUrl) : f.fileUrl,
        })) || [],
    } as any;

    // Remove fields not desired in response, if present
    if ("deletedForUsers" in transformedMessage) {
      delete (transformedMessage as any).deletedForUsers;
    }

    const response = {
      success: true,
      message: "Message sent successfully",
      data: transformedMessage,
    };

    transactionResult.members
      .filter((member) => member.userId !== userIdInt)
      .forEach((member) => {
        if (member.userId) {
          request.server.io
            .to(member.userId.toString())
            .emit("new_message", response);
        }
      });

    return reply.status(201).send(response);
  } catch (error) {
    try {
      const files = (request.files as any[]) || [];
      const uploadedFilenames = files.map((f) => f.filename).filter(Boolean);
      if (uploadedFilenames.length) {
        FileService.removeFiles(uploadedFilenames);
      }
    } catch (_) {}
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

    const files = await prisma.messageFile.findMany({
      where: { messageId },
      select: { fileUrl: true },
    });

    await prisma.$transaction([
      prisma.messageFile.deleteMany({ where: { messageId } }),
      prisma.message.update({
        where: { id: messageId },
        data: { text: "Message is deleted" },
      }),
    ]);

    try {
      const filenames = files.map((f) => f.fileUrl).filter(Boolean);
      if (filenames.length) {
        FileService.removeFiles(filenames);
      }
    } catch (_) {}

    // Broadcast deletion to all conversation members
    try {
      const members = await prisma.conversationMember.findMany({
        where: {
          conversationId: message.conversationId,
          isDeleted: false,
          userId: {
            not: myIdInt,
          },
        },
        select: { userId: true },
      });

      const payload = {
        success: true,
        message: "Message deleted for everyone",
        data: {
          messageId,
          conversationId: message.conversationId,
        },
      };

      console.log("??????=============????", members);
      console.log("??????????", payload);
      members.forEach((member) => {
        if (member.userId) {
          request.server.io
            .to(member.userId.toString())
            .emit("message_deleted_for_everyone", payload);
        }
      });
    } catch (_) {}

    return reply.send({
      success: true,
      message: "Message deleted for everyone",
      data: {
        messageId,
        conversationId: message.conversationId,
      },
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
        NOT: {
          userId: myIdInt,
        },
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
          NOT: {
            userId: myIdInt,
          },
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

    const readStatusData = {
      success: true,
      conversationId,
      markedBy: myIdInt,
      markedCount: result.count,
      messageIds: unreadMessages.map((m) => m.id),
    };

    console.log("readStatusData", readStatusData);

    members.forEach((member) => {
      if (member.userId) {
        request.server.io
          .to(member.userId.toString())
          .emit("messages_marked_read", readStatusData);
      }
    });

    const responseData = {
      success: true,
      message: "Messages marked as read",
      data: {
        conversationId,
        markedCount: result.count,
        totalUnreadMessages: unreadMessages.length,
      },
    };

    return reply.send(responseData);
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
