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
            // Messages are unread and undelivered by default, will be marked as read/delivered if recipients are in room
            isRead: false,
            isDelivered: false,
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

    // Check which users are currently in the conversation room
    // This is critical for marking messages as read/delivered when users are active in the room
    const usersInRoom = request.server.getUsersInConversationRoom
      ? request.server.getUsersInConversationRoom(conversationId)
      : [];
    
    // Convert room user IDs to numbers for comparison
    // getUsersInConversationRoom returns string[], so we need to parse them
    const usersInRoomNumbers = usersInRoom
      .map((id) => {
        const numId = typeof id === "string" ? parseInt(id, 10) : Number(id);
        return isNaN(numId) ? null : numId;
      })
      .filter((id): id is number => id !== null);
    
    // Also check which users are online (even if not in room)
    const onlineUsersMap = request.server.onlineUsers || new Map();
    const onlineUserIds: number[] = [];
    for (const [userIdStr, socketSet] of onlineUsersMap.entries()) {
      const userIdNum = parseInt(userIdStr, 10);
      if (!isNaN(userIdNum) && socketSet && socketSet.size > 0) {
        onlineUserIds.push(userIdNum);
      }
    }
    
    const usersInRoomSet = new Set(usersInRoomNumbers);
    
    // Get all member IDs for comparison
    const allMemberIds = transactionResult.members
      .map((m) => m.userId)
      .filter((id): id is number => typeof id === "number");
    
    request.log.info(
      `🔍 Room Check - Conversation: ${conversationId}, Sender: ${userIdInt}, Users in room: [${usersInRoomNumbers.join(", ")}], Online users: [${onlineUserIds.join(", ")}], All members: [${allMemberIds.join(", ")}]`
    );

    // Filter: Only mark as read/delivered if recipients (NOT sender) are in the room
    // When multiple people are in the same conversation room, messages should be marked as delivered and read
    const recipientsInRoom = transactionResult.members.filter((member) => {
      if (!member.userId || member.userId === userIdInt) {
        return false;
      }
      const isInRoom = usersInRoomSet.has(member.userId);
      if (isInRoom) {
        request.log.info(`✅ Recipient ${member.userId} is in room ${conversationId}`);
      }
      return isInRoom;
    });

    let messageForResponse = transactionResult.message;
    let wasMarkedAsRead = false;
    let recipientsInRoomIds: number[] = [];
    
    // If recipients are in room, mark message as read and delivered immediately (before sending response)
    // This ensures that when multiple people are in the same conversation room,
    // isDelivered and isRead are set to true automatically
    if (recipientsInRoom.length > 0) {
      recipientsInRoomIds = recipientsInRoom
        .map((m) => m.userId)
        .filter((id): id is number => typeof id === "number");
      
      // 🔥 CRITICAL: Double-check RIGHT BEFORE marking as read/delivered
      // This prevents race condition where user leaves between initial check and DB update
      const finalVerification = recipientsInRoomIds.filter((recipientId) => {
        if (!request.server.isUserInConversationRoom) {
          return false;
        }
        const stillInRoom = request.server.isUserInConversationRoom(
          recipientId.toString(),
          conversationId
        );
        if (!stillInRoom) {
          request.log.warn(
            `⚠️ Recipient ${recipientId} left room ${conversationId} before message was marked as read - excluding from read/delivered status`
          );
        }
        return stillInRoom;
      });
      
      // Only mark as read/delivered if recipients are STILL in room after final verification
      if (finalVerification.length > 0) {
        // Update recipientsInRoomIds to only include those still in room after verification
        recipientsInRoomIds = finalVerification;
        
        request.log.info(
          `📨 Marking message ${transactionResult.message.id} as read/delivered for ${finalVerification.length} recipients still in room: [${finalVerification.join(", ")}] (originally ${recipientsInRoom.length} were in room)`
        );
        
        try {
          // Update message to mark as read and delivered
          const updateResult = await prisma.message.update({
            where: { id: transactionResult.message.id },
            data: { 
              isRead: true, 
              isDelivered: true 
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
        });
        
        // Verify that the update was successful
        if (updateResult.isRead === true && updateResult.isDelivered === true) {
          messageForResponse = updateResult;
          wasMarkedAsRead = true;
          request.log.info(
            `✅ SUCCESS: Message ${transactionResult.message.id} marked as read/delivered. isRead=${updateResult.isRead}, isDelivered=${updateResult.isDelivered}`
          );
        } else {
          request.log.error(
            `❌ FAILED: Message update did not set flags correctly. Expected: isRead=true, isDelivered=true. Got: isRead=${updateResult.isRead}, isDelivered=${updateResult.isDelivered}`
          );
          messageForResponse = updateResult; // Still use updated result even if flags are wrong
        }
      } catch (error: any) {
        request.log.error(`❌ ERROR: Failed to mark message as read synchronously: ${error.message}`, error);
        request.log.error(`Error stack: ${error.stack}`);
        // Keep original message if update fails
        messageForResponse = transactionResult.message;
      }
      } else {
        // All recipients left the room before we could mark as read
        request.log.warn(
          `⚠️ All recipients left room ${conversationId} before message ${transactionResult.message.id} could be marked as read. Message will remain unread/undelivered.`
        );
        // Message will remain unread/undelivered
      }
    } else {
      request.log.warn(
        `⚠️ No recipients in room for message ${transactionResult.message.id}. Users in room: [${usersInRoomNumbers.join(", ")}], All members: [${participantIds.join(", ")}], Sender: ${userIdInt}`
      );
      // Message will remain unread/undelivered
    }

    const transformedMessage = transformMessage(
      messageForResponse,
      participantIds
    );

    // Log final message status for debugging
    request.log.info(
      `📤 Final response - Message ID: ${transformedMessage.id}, isRead: ${transformedMessage.isRead}, isDelivered: ${transformedMessage.isDelivered}, wasMarkedAsRead: ${wasMarkedAsRead}, recipientsInRoom: ${recipientsInRoomIds.length > 0 ? `[${recipientsInRoomIds.join(", ")}]` : "none"}`
    );

    const response = {
      success: true,
      message: "Message sent successfully",
      data: transformedMessage,
    };

    setImmediate(async () => {
      try {
        const pushPromises: Promise<any>[] = [];

        // If message was marked as read/delivered (because recipients are in conversation room),
        // emit real-time updates to notify all members
        if (wasMarkedAsRead && messageForResponse.isRead && messageForResponse.isDelivered) {
          // Emit read status update
          const readStatusData = {
            success: true,
            conversationId,
            markedBy: userIdInt,
            markedAsRead: true,
            messageId: messageForResponse.id,
            recipientsInRoom: recipientsInRoomIds,
          };

          // Emit delivered status update
          const deliveredStatusData = {
            success: true,
            conversationId,
            markedBy: userIdInt,
            isDelivered: true,
            messageId: messageForResponse.id,
            recipientsInRoom: recipientsInRoomIds,
          };

          // Emit to all conversation members to notify about read/delivered status
          transactionResult.members.forEach((member) => {
            if (member.userId) {
              request.server.io
                .to(member.userId.toString())
                .emit("messages_marked_read", readStatusData);
              
              request.server.io
                .to(member.userId.toString())
                .emit("message_delivered", deliveredStatusData);
            }
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
                request.server.sendDataPush(token, pushData)
                  .then((result) => {
                    // If token is invalid, we should remove it from user's fcmToken array
                    if (!result.success && result.shouldRemoveToken && member.userId) {
                      request.log.info(`Removing invalid FCM token for user ${member.userId}`);
                      // Remove invalid token asynchronously (non-blocking)
                      prisma.user.update({
                        where: { id: member.userId },
                        data: {
                          fcmToken: {
                            set: validTokens.filter((t) => t !== token),
                          },
                        },
                      }).catch((err) => {
                        request.log.error(`Failed to remove invalid token for user ${member.userId}: ${err.message}`);
                      });
                    }
                    return result;
                  })
                  .catch((error) => {
                    request.log.warn(
                      { token, error: error?.message || error },
                      "Push notification failed"
                    );
                    return { success: false, error: error?.message || "Unknown error" };
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