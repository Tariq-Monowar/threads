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
import { transformMessage } from "../../../utils/message.utils";

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

    const missingField = ["conversationId", "userId"].find(
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
        select: {
          id: true,
          isGroup: true,
          name: true,
          allowMemberMessage: true,
        },
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
            // Messages are unread by default, will be marked as read if user is in room
            isRead: false,
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
            isAdmin: true,
            user: {
              select: {
                id: true,
                fcmToken: true,
              },
            },
          },
        }),
        tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        }),
      ]);

      return { message, members, conversation };
    });

    const participantIds = transactionResult.members
      .map((m) => m.userId)
      .filter((id): id is number => typeof id === "number");

    /*
    Along with the main data, include the following permission & conversation details in every push message:
    isGroup
    isAdmin (for the recipient)
    isAllowMemberMessage
    conversationName
    */

    const transformedMessage = transformMessage(
      transactionResult.message,
      participantIds
    );

    const response = {
      success: true,
      message: "Message sent successfully",
      data: transformedMessage,
    };

    setImmediate(async () => {
      try {
        const pushPromises: Promise<any>[] = [];
        
        // Check which users are currently in the conversation room
        const usersInRoom = request.server.getUsersInConversationRoom
          ? request.server.getUsersInConversationRoom(conversationId)
          : [];
        const usersInRoomSet = new Set(usersInRoom.map((id) => parseInt(id)).filter((id) => !isNaN(id)));

        // Mark message as read for users currently in the conversation room (excluding sender)
        const usersToMarkAsRead = transactionResult.members
          .filter((member) => member.userId && member.userId !== userIdInt && usersInRoomSet.has(member.userId))
          .map((member) => member.userId!);

        if (usersToMarkAsRead.length > 0) {
          await prisma.message.update({
            where: { id: transactionResult.message.id },
            data: { isRead: true },
          }).catch((error) => {
            request.log.warn(`Failed to mark message as read for users in room: ${error.message}`);
          });
        }

        for (const member of transactionResult.members) {
          if (member.userId === userIdInt) {
            continue;
          }

          // Prepare push data with conversation details for this recipient
          const pushData = {
            type: "new_message",
            success: "true",
            message: "Message sent successfully",
            data: JSON.stringify({
              ...transformedMessage,
              isGroup: transactionResult.conversation.isGroup,
              isAdmin: member.isAdmin || false,
              isAllowMemberMessage: transactionResult.conversation.allowMemberMessage,
              conversationName: transactionResult.conversation.name || null,
            }),
          };

          console.log("pushData", pushData);
          // Send socket event (non-blocking)
          if (member.userId) {
            request.server.io
              .to(member.userId.toString())
              .emit("new_message", response);
          }

          const fcmTokens = member.user?.fcmToken || [];
          if (Array.isArray(fcmTokens) && fcmTokens.length > 0) {
            const validTokens = fcmTokens.filter((token): token is string =>
              Boolean(token)
            );

            // Add all push promises to array for parallel execution
            for (const token of validTokens) {
              pushPromises.push(
                request.server.sendDataPush(token, pushData).catch((error) => {
                  request.log.warn(
                    { token, error: error?.message || error },
                    "Push notification failed"
                  );
                  return { success: false, error };
                })
              );
            }
          }
        }

        if (pushPromises.length > 0) {
          await Promise.allSettled(pushPromises);
        }
      } catch (error) {
        request.log.error(error, "Error sending notifications");
      }
    });

    reply.status(201).send(response);
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
      where: { id: messageId },
      select: { conversationId: true, deletedForUsers: true },
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
      select: { id: true },
    });

    if (!conversationMember) {
      return reply.status(403).send({
        success: false,
        message: "You don't have access to this conversation",
      });
    }

    if (
      Array.isArray(message.deletedForUsers) &&
      message.deletedForUsers.includes(myIdInt)
    ) {
      return reply.status(400).send({
        success: false,
        message: "Message already deleted for you",
      });
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        deletedForUsers: { push: myIdInt },
      },
    });

    return reply.send({
      success: true,
      message: "Message deleted for you",
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

export const updateMessage = async (request, reply) => {
  try {
    const { messageId } = request.params;
    const { myId, text } = request.body;
    const prisma = request.server.prisma;

    if (!messageId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "messageId and myId are required!",
      });
    }

    const files = (request.files as any[]) || [];
    const uploadedFilenames = files.map((f) => f.filename).filter(Boolean);

    if (
      (!text || typeof text !== "string" || text.trim() === "") &&
      files.length === 0
    ) {
      return reply.status(400).send({
        success: false,
        message: "Provide text or at least one file to update",
      });
    }

    const myIdInt = parseInt(myId);

    const existing = await prisma.message.findFirst({
      where: { id: messageId, userId: myIdInt },
      select: { id: true, conversationId: true },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        message: "Message not found or you don't have permission to update it",
      });
    }

    let oldFiles: { fileUrl: string }[] = [];
    if (files.length > 0) {
      oldFiles = await prisma.messageFile.findMany({
        where: { messageId },
        select: { fileUrl: true },
      });
    }

    const filesCreate = files.length
      ? files.map((file) => ({
          userId: myIdInt,
          fileUrl: file.filename,
          fileType: file.mimetype || null,
          fileSize: typeof file.size === "number" ? file.size : null,
          fileExtension:
            path.extname(file.originalname || "").replace(".", "") || null,
        }))
      : [];

    const updated = await prisma.$transaction(async (tx) => {
      if (files.length > 0) {
        await tx.messageFile.deleteMany({ where: { messageId } });
      }

      return tx.message.update({
        where: { id: messageId },
        data: {
          ...(text && typeof text === "string" && text.trim() !== ""
            ? { text: text.trim() }
            : {}),
          ...(filesCreate.length
            ? {
                MessageFile: {
                  create: filesCreate,
                },
              }
            : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true } },
          MessageFile: true,
        },
      });
    });

    const members = await prisma.conversationMember.findMany({
      where: {
        conversationId: existing.conversationId,
        isDeleted: false,
      },
      select: { userId: true },
    });

    const participantIds = members
      .map((m) => m.userId)
      .filter((id): id is number => typeof id === "number");

    const transformed = transformMessage(updated, participantIds);

    const response = {
      success: true,
      message: "Message updated successfully",
      data: transformed,
    };

    const otherMembers = members.filter((m) => m.userId !== myIdInt);
    otherMembers.forEach((member) => {
      if (member.userId) {
        request.server.io
          .to(member.userId.toString())
          .emit("message_updated", response);
      }
    });

    // Remove old files from disk after successful update
    try {
      if (files.length > 0 && oldFiles.length) {
        FileService.removeFiles(oldFiles.map((f) => f.fileUrl).filter(Boolean));
      }
    } catch (_) {}

    return reply.send(response);
  } catch (error) {
    // Rollback uploaded files from disk on error
    try {
      const files = (request.files as any[]) || [];
      const uploadedFilenames = files.map((f) => f.filename).filter(Boolean);
      if (uploadedFilenames.length) {
        FileService.removeFiles(uploadedFilenames);
      }
    } catch (_) {}
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to update message",
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

    if (!conversationId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId is required!",
      });
    }
    if (!myId) {
      return reply.status(400).send({
        success: false,
        message: "myId is required!",
      });
    }

    const currentPage = Math.max(parseInt(page.toString()) || 1, 1);
    const perPage = Math.min(
      Math.max(parseInt(limit.toString()) || 10, 1),
      100
    );
    const offset = (currentPage - 1) * perPage;

    const myIdInt = parseInt(myId);

    const member = await prisma.conversationMember.findFirst({
      where: { conversationId, userId: myIdInt, isDeleted: false },
      select: { id: true },
    });
    if (!member) {
      return reply.status(403).send({
        success: false,
        message: "You don't have access to this conversation",
      });
    }

    // Fetch all participant userIds for receiverId computation
    const participants = await prisma.conversationMember.findMany({
      where: { conversationId, isDeleted: false },
      select: { userId: true },
    });
    const participantIds = participants
      .map((p) => p.userId)
      .filter((id): id is number => typeof id === "number");

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        NOT: { deletedForUsers: { has: myIdInt } },
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        MessageFile: true,
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: perPage + 1,
    });

    const hasMore = rows.length > perPage;
    const pageRows = hasMore ? rows.slice(0, perPage) : rows;

    const data = pageRows.map((m: any) => transformMessage(m, participantIds));

    return reply.send({
      success: true,
      data,
      pagination: {
        currentPage,
        itemsPerPage: perPage,
        hasNextPage: hasMore,
        hasPrevPage: currentPage > 1,
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
