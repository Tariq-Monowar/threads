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
    // Step 1: Get data from request
    const { conversationId, userId, text } = request.body;
    const prisma = request.server.prisma;
    const uploadedFiles = (request.files as any[]) || [];

    // Step 2: Validate input
    if (!conversationId || !userId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and userId are required!",
      });
    }

    const hasText = text && text.trim() !== "";
    const hasFiles = uploadedFiles.length > 0;
    if (!hasText && !hasFiles) {
      return reply.status(400).send({
        success: false,
        message: "Either text or at least one file is required!",
      });
    }

    const senderId = parseInt(userId);

    // Step 3: Get conversation info and all members
    const { conversation, members } = await prisma.$transaction(async (tx) => {
      // Check if conversation exists and user has access
      const conv = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          members: { some: { userId: senderId, isDeleted: false } },
        },
        select: { id: true, isGroup: true, name: true, allowMemberMessage: true },
      });

      if (!conv) {
        throw new Error("Conversation not found or you don't have access to it");
      }

      // Get all members of this conversation
      const allMembers = await tx.conversationMember.findMany({
        where: { conversationId, isDeleted: false },
        select: {
          userId: true,
          isAdmin: true,
          user: { select: { id: true, fcmToken: true } },
        },
      });

      return { conversation: conv, members: allMembers };
    });

    // Step 4: Check if any receiver is currently in the conversation room
    const conversationIdAsString = String(conversationId);
    const userIdsInRoom = request.server.getUsersInConversationRoom?.(conversationIdAsString) || [];
    
    // Debug: Log room state
    console.log("=== Room Check ===");
    console.log("Conversation ID:", conversationIdAsString);
    console.log("Users in room:", userIdsInRoom);
    console.log("Sender ID:", senderId);
    
    // Check if any receiver (not sender) is in the room
    let hasAnyReceiverInRoom = false;
    
    // If room is empty, no one is in room
    if (userIdsInRoom.length === 0) {
      console.log("Room is empty - no receivers in room");
      hasAnyReceiverInRoom = false;
    } else {
      // Check each member
      for (const member of members) {
        // Skip sender
        if (!member.userId || member.userId === senderId) {
          continue;
        }
        
        // Convert member ID to string for comparison
        const memberIdAsString = String(member.userId);
        
        // Check if this receiver is in the room
        const isInRoom = userIdsInRoom.includes(memberIdAsString);
        console.log(`Receiver ${member.userId} (${memberIdAsString}) in room?`, isInRoom);
        
        if (isInRoom) {
          hasAnyReceiverInRoom = true;
          console.log(`✓ Found receiver ${member.userId} in room`);
          break; // Found one, no need to check more
        }
      }
    }

    console.log("Final result - shouldMarkAsRead:", hasAnyReceiverInRoom);
    console.log("==================");

    // Step 5: If any receiver is in room, mark message as read/delivered
    const shouldMarkAsRead = hasAnyReceiverInRoom;

    // Step 6: Prepare file data if files were uploaded
    const fileDataForDatabase = uploadedFiles.map((file) => ({
      userId: senderId,
      fileUrl: file.filename,
      fileType: file.mimetype || null,
      fileSize: typeof file.size === "number" ? file.size : null,
      fileExtension: path.extname(file.originalname || "").replace(".", "") || null,
    }));

    // Step 7: Create the message in database
    const createdMessage = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.message.create({
        data: {
          text: hasText ? text.trim() : null,
          userId: senderId,
          conversationId,
          isRead: shouldMarkAsRead,
          isDelivered: shouldMarkAsRead,
          ...(fileDataForDatabase.length > 0 ? { MessageFile: { create: fileDataForDatabase } } : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true } },
          MessageFile: true,
        },
      });

      // Update conversation's last updated time
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return newMessage;
    });

    // Step 8: Prepare response data
    const allParticipantIds = members
      .map((member) => member.userId)
      .filter((id): id is number => typeof id === "number");

    const messageForResponse = transformMessage(createdMessage, allParticipantIds);
    const response = {
      success: true,
      message: "Message sent successfully",
      data: messageForResponse,
    };

    // Step 9: Send notifications in background (don't wait for this)
    setImmediate(async () => {
      try {
        const pushNotificationPromises: Promise<any>[] = [];

        // If message was marked as read, notify everyone about read status
        if (shouldMarkAsRead) {
          const readStatusInfo = {
            success: true,
            conversationId,
            markedBy: senderId,
            messageId: createdMessage.id,
            markedAsRead: true,
          };

          const deliveredStatusInfo = {
            success: true,
            conversationId,
            markedBy: senderId,
            messageId: createdMessage.id,
            isDelivered: true,
          };

          // Send read/delivered status to all members
          members.forEach((member) => {
            if (member.userId) {
              const memberIdAsString = member.userId.toString();
              request.server.io.to(memberIdAsString).emit("messages_marked_read", readStatusInfo);
              request.server.io.to(memberIdAsString).emit("message_delivered", deliveredStatusInfo);
            }
          });
        }

        // Send new message notification to all recipients (except sender)
        for (const member of members) {
          // Skip sender
          if (member.userId === senderId) {
            continue;
          }

          // Send socket event to this recipient
          if (member.userId) {
            request.server.io.to(member.userId.toString()).emit("new_message", response);
          }

          // Send push notification if user has FCM tokens
          const userFcmTokens = member.user?.fcmToken || [];
          if (Array.isArray(userFcmTokens) && userFcmTokens.length > 0) {
            const validFcmTokens = userFcmTokens.filter((token) => Boolean(token));

            const pushNotificationData = {
              type: "new_message",
              success: "true",
              message: "Message sent successfully",
              data: JSON.stringify({
                ...messageForResponse,
                isGroup: conversation.isGroup,
                isAdmin: member.isAdmin || false,
                isAllowMemberMessage: conversation.allowMemberMessage,
                conversationName: conversation.name || null,
              }),
            };

            // Send push to each token
            for (const token of validFcmTokens) {
              pushNotificationPromises.push(
                request.server.sendDataPush(token, pushNotificationData)
                  .then((result) => {
                    // If token is invalid, remove it from user's tokens
                    if (!result.success && result.shouldRemoveToken && member.userId) {
                      prisma.user.update({
                        where: { id: member.userId },
                        data: { fcmToken: { set: validFcmTokens.filter((t) => t !== token) } },
                      }).catch((err) => {
                        request.log.error(`Failed to remove invalid token: ${err.message}`);
                      });
                    }
                    return result;
                  })
                  .catch((error) => {
                    request.log.warn({ token, error: error?.message }, "Push notification failed");
                    return { success: false, error: error?.message || "Unknown error" };
                  })
              );
            }
          }
        }

        // Wait for all push notifications to complete
        if (pushNotificationPromises.length > 0) {
          await Promise.allSettled(pushNotificationPromises);
        }
      } catch (error) {
        request.log.error(error, "Error sending notifications");
      }
    });

    // Step 10: Send response to client
    reply.status(201).send(response);
  } catch (error) {
    // Cleanup: Delete uploaded files if something went wrong
    try {
      const uploadedFiles = (request.files as any[]) || [];
      const fileNames = uploadedFiles.map((f) => f.filename).filter(Boolean);
      if (fileNames.length > 0) {
        FileService.removeFiles(fileNames);
      }
    } catch (_) {}

    request.log.error(error);

    // Return appropriate error response
    if (error.message === "Conversation not found or you don't have access to it") {
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
          isDelivered: true, // If message is read, it must be delivered
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
      // markedCount: result.count,
      // messageIds: unreadMessages.map((m) => m.id),
      markedAsRead: true,
    };

    console.log("readStatusData", readStatusData);

    // Emit to other members only (exclude the user who made the API call)
    members.forEach((member) => {
      if (member.userId && member.userId !== myIdInt) {
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
        markedAsRead: true,
        // markedCount: result.count,
        // totalUnreadMessages: unreadMessages.length,
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

export const markMessageAsDelivered = async (request, reply) => {
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

    // Ensure the user is part of the conversation
    const conversationMember = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: myIdInt,
        isDeleted: false,
      },
      select: {
        id: true,
      },
    });

    if (!conversationMember) {
      return reply.status(403).send({
        success: false,
        message: "You don't have access to this conversation",
      });
    }

    // Find all undelivered messages in this conversation from OTHER users
    const undeliveredMessages = await prisma.message.findMany({
      where: {
        conversationId,
        isDelivered: false,
        NOT: {
          userId: myIdInt,
        },
      },
      select: {
        id: true,
      },
    });

    if (undeliveredMessages.length === 0) {
      return reply.send({
        success: true,
        message: "All messages already marked as delivered",
        data: {
          markedCount: 0,
          totalUndeliveredMessages: 0,
        },
      });
    }

    const [result, members] = await Promise.all([
      prisma.message.updateMany({
        where: {
          conversationId,
          isDelivered: false,
          NOT: {
            userId: myIdInt,
          },
        },
        data: {
          isDelivered: true,
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

    // Notify all members in this conversation (especially the sender)
    try {
      const payload = {
        success: true,
        message: "Messages marked as delivered",
        data: {
          conversationId,
          markedBy: myIdInt,
          isDelivered: true,
        },
      };

      // Emit to other members only (exclude the user who made the API call)
      members.forEach((member) => {
        if (member.userId && member.userId !== myIdInt) {
          request.server.io
            .to(member.userId.toString())
            .emit("message_delivered", payload);
        }
      });
    } catch (_) {}

    return reply.send({
      success: true,
      message: "Messages marked as delivered",
      data: {
        conversationId,
        isDelivered: true,
        // : true,
        // markedCount: result.count,
        // totalUndeliveredMessages: undeliveredMessages.length,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to mark message as delivered",
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