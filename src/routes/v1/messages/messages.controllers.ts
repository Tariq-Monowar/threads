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
import { getJsonArray, jsonArrayContains, jsonArrayAdd } from "../../../utils/jsonArray";

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

// export const sendMessage = async (request, reply) => {
//   try {
//     const { conversationId, userId, text } = request.body;
//     const prisma = request.server.prisma;


//     // validate request body
//     const requiredFields = ["conversationId", "userId"];
//     const missing = requiredFields.find(f => !request.body[f]);
//     if (missing) {
//       return reply.status(400).send({
//         success: false,
//         message: `${missing} is required`,
//       });
//     }
    
//     const userIdInt = parseInt(userId);

//     const files = request.files;

//     if ((!text || text.trim() === "") && files.length === 0) {
//       return reply.status(400).send({
//         success: false,
//         message: "Either text or at least one file is required!",
//       });
//     }

//     // Check if conversation exists and if user is blocked (for private conversations)
//     const conversationCheck = await prisma.conversation.findUnique({
//       where: { id: conversationId },
//       include: {
//         members: {
//           where: { isDeleted: false },
//           select: { userId: true },
//         },
//       },
//     });

//     if (!conversationCheck) {
//       return reply.status(404).send({
//         success: false,
//         message: "Conversation not found",
//       });
//     }

//     // Block check for private conversations only
//     if (!conversationCheck.isGroup) {
//       const otherMember = conversationCheck.members.find((m) => m.userId !== userIdInt);
//       if (otherMember?.userId) {
//         const isBlocked = await prisma.block.findFirst({
//           where: {
//             OR: [
//               { blockerId: userIdInt, blockedId: otherMember.userId },
//               { blockerId: otherMember.userId, blockedId: userIdInt },
//             ],
//           },
//         });
//         if (isBlocked) {
//           return reply.status(403).send({
//             success: false,
//             message: "Cannot send message. User is blocked.",
//           });
//         }
//       }
//     }

//     // Create message and get conversation members
//     const transactionResult = await prisma.$transaction(async (tx) => {
//       const conversation = await tx.conversation.findFirst({
//         where: {
//           id: conversationId,
//           members: { some: { userId: userIdInt, isDeleted: false } },
//         },
//         select: {
//           id: true,
//           isGroup: true,
//           name: true,
//           allowMemberMessage: true,
//         },
//       });

//       if (!conversation) {
//         throw new Error("Conversation not found or you don't have access to it");
//       }

//       const filesCreate = files.length > 0
//         ? files.map((file) => ({
//             userId: userIdInt,
//             fileUrl: file.filename,
//             fileType: file.mimetype || null,
//             fileSize: typeof file.size === "number" ? file.size : null,
//             fileExtension: path.extname(file.originalname || "").replace(".", "") || null,
//           }))
//         : [];

//       const [message, members] = await Promise.all([
//         tx.message.create({
//           data: {
//             text: text?.trim() || null,
//             userId: userIdInt,
//             conversationId,
//             isRead: false,
//             isDelivered: false,
//             ...(filesCreate.length > 0 ? { MessageFile: { create: filesCreate } } : {}),
//           },
//           include: {
//             user: { select: { id: true, name: true, email: true, avatar: true } },
//             MessageFile: true,
//           },
//         }),
//         tx.conversationMember.findMany({
//           where: { conversationId, isDeleted: false },
//           select: {
//             userId: true,
//             isAdmin: true,
//             isMute: true,
//             user: { 
//               select: { 
//                 id: true, 
//                 fcmToken: true 
//               } 
//             },
//           },
//         }),
//       ]);

//       // Update conversation timestamp separately
//       await tx.conversation.update({
//         where: { id: conversationId },
//         data: { updatedAt: new Date() },
//       });

//       return { message, members, conversation };
//     });

//     // Log member data for debugging
//     request.log.info(`[DEBUG] Transaction completed. Members count: ${transactionResult.members.length}`);
//     transactionResult.members.forEach((m) => {
//       request.log.info(`[DEBUG] Member ${m.userId}: isMute=${m.isMute}, hasUser=${!!m.user}, fcmTokens=${m.user?.fcmToken?.length || 0}`);
//     });

//     const participantIds = transactionResult.members
//       .map((m) => m.userId)
//       .filter((id): id is number => typeof id === "number");

//     // Check if any recipient (not sender) is in conversation room
//     let messageForResponse = transactionResult.message;
//     let wasMarkedAsRead = false;
    
//     if (request.server.getUsersInConversationRoom && request.server.isUserInConversationRoom) {
//       const usersInRoom = request.server.getUsersInConversationRoom(conversationId);
      
//       // Check if any recipient is in room
//       const hasRecipientInRoom = transactionResult.members.some((member) => {
//         if (!member.userId || member.userId === userIdInt) return false;
//         return request.server.isUserInConversationRoom(member.userId.toString(), conversationId);
//       });

//       // Mark as read/delivered if any recipient is in room
//       if (hasRecipientInRoom) {
//         try {
//           const updateResult = await prisma.message.update({
//             where: { id: transactionResult.message.id },
//             data: { isRead: true, isDelivered: true },
//             include: {
//               user: { select: { id: true, name: true, email: true, avatar: true } },
//               MessageFile: true,
//             },
//           });
//           messageForResponse = updateResult;
//           wasMarkedAsRead = true;
//         } catch (error) {
//           request.log.error(error);
//         }
//       }
//     }

//     const transformedMessage = transformMessage(messageForResponse, participantIds);

//     const response = {
//       success: true,
//       message: "Message sent successfully",
//       data: transformedMessage,
//     };

//     // Send notifications asynchronously
//     setImmediate(async () => {
//       try {
//         request.log.info(`[PUSH] ========== Starting push notification process ==========`);
//         request.log.info(`[PUSH] Conversation ID: ${conversationId}, Sender: ${userIdInt}`);
//         request.log.info(`[PUSH] Total members: ${transactionResult.members.length}`);
//         request.log.info(`[PUSH] sendDataPush available: ${!!request.server.sendDataPush}`);
//         const pushPromises: Promise<any>[] = [];

//         // Emit read/delivered status if message was marked
//         if (wasMarkedAsRead) {
//           const statusData = {
//             success: true,
//             conversationId,
//             markedBy: userIdInt,
//             markedAsRead: true,
//             isDelivered: true,
//             messageId: messageForResponse.id,
//           };

//           transactionResult.members.forEach((member) => {
//             if (member.userId) {
//               request.server.io.to(member.userId.toString()).emit("messages_marked_read", statusData);
//               request.server.io.to(member.userId.toString()).emit("message_delivered", statusData);
//             }
//           });
//         }

//         // Send socket events to all members (including muted)
//         transactionResult.members.forEach((member) => {
//           if (member.userId && member.userId !== userIdInt) {
//             request.server.io.to(member.userId.toString()).emit("new_message", response);
//           }
//         });

         

//         // Send push notifications only to non-muted members
//         if (!request.server.sendDataPush) {
//           request.log.warn("[PUSH] sendDataPush method not available on server instance");
//           return;
//         }

//         request.log.info(`[PUSH] sendDataPush method is available, processing ${transactionResult.members.length} members`);

//         for (const member of transactionResult.members) {
//           if (member.userId === userIdInt) {
//             request.log.info(`[PUSH] Skipping sender ${member.userId}`);
//             continue;
//           }
          
//           request.log.info(`[PUSH] Processing member ${member.userId}, isMute: ${member.isMute}`);
          
//           // Skip push notification if member has muted the conversation
//           if (member.isMute) {
//             request.log.info(`[PUSH] Skipping push notification for muted member ${member.userId}`);
//             continue;
//           }

//           // Check if user data exists
//           if (!member.user) {
//             request.log.warn(`[PUSH] No user data found for member ${member.userId} - fetching from database`);
//             // Try to fetch user data if not loaded
//             try {
//               const userData = await prisma.user.findUnique({
//                 where: { id: member.userId },
//                 select: { id: true, fcmToken: true },
//               });
//               if (!userData) {
//                 request.log.warn(`[PUSH] User ${member.userId} not found in database`);
//                 continue;
//               }
//               member.user = userData;
//             } catch (err) {
//               request.log.error(`[PUSH] Error fetching user data for ${member.userId}:`, err);
//               continue;
//             }
//           }

//           const fcmTokens = getJsonArray<string>(member.user?.fcmToken, []);
//           request.log.info(`[PUSH] Member ${member.userId} has ${fcmTokens.length} FCM token(s)`);
          
//           if (fcmTokens.length === 0) {
//             request.log.warn(`[PUSH] No FCM tokens found for member ${member.userId}`);
//             continue;
//           }

//           const validTokens = fcmTokens.filter((token): token is string => typeof token === 'string' && token.trim().length > 0);
//           if (validTokens.length === 0) {
//             request.log.warn(`[PUSH] No valid FCM tokens for member ${member.userId}`);
//             continue;
//           }

//           request.log.info(`[PUSH] Sending push notification to member ${member.userId} (${validTokens.length} token(s))`);

//           // Prepare push data - all values must be strings (sendDataPush will stringify the entire object)
//           const pushData: Record<string, string> = {
//             type: "new_message",
//             success: "true",
//             message: "Message sent successfully",
//             data: JSON.stringify({
//               ...transformedMessage,
//               isGroup: transactionResult.conversation.isGroup,
//               isAdmin: member.isAdmin || false,
//               isAllowMemberMessage: transactionResult.conversation.allowMemberMessage,
//               conversationName: transactionResult.conversation.name || null,
//             }),
//           };

//           request.log.info(`[PUSH] Push data prepared for member ${member.userId}:`, JSON.stringify(pushData, null, 2));

//           for (const token of validTokens) {
//             request.log.info(`[PUSH] Attempting to send push to token: ${token.substring(0, 20)}...`);
//             pushPromises.push(
//               request.server.sendDataPush(token, pushData)
//                 .then((result) => {
//                   if (result.success) {
//                     request.log.info(`[PUSH] ✅ Push notification sent successfully to member ${member.userId}, messageId: ${result.messageId}`);
//                   } else {
//                     request.log.warn(`[PUSH] ❌ Push notification failed for member ${member.userId}: ${result.error || "Unknown error"}, code: ${result.code || "N/A"}`);
//                   }
//                   if (!result.success && result.shouldRemoveToken && member.userId) {
//                     request.log.info(`[PUSH] Removing invalid token for member ${member.userId}`);
//                     prisma.user.update({
//                       where: { id: member.userId },
//                       data: {
//                         fcmToken: validTokens.filter((t) => t !== token),
//                       },
//                     }).catch((err) => {
//                       request.log.error(`[PUSH] Failed to remove invalid token for user ${member.userId}: ${err.message}`);
//                     });
//                   }
//                   return result;
//                 })
//                 .catch((error) => {
//                   request.log.error(`[PUSH] ❌ Push notification error for member ${member.userId}: ${error.message || error}`, error);
//                   return { success: false, error: error.message || "Unknown error" };
//                 })
//             );
//           }
//         }

//         request.log.info(`[PUSH] Total push promises: ${pushPromises.length}`);
//         if (pushPromises.length > 0) {
//           const results = await Promise.allSettled(pushPromises);
//           const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
//           const failed = results.length - successful;
//           request.log.info(`[PUSH] ========== Push notification summary ==========`);
//           request.log.info(`[PUSH] Total attempts: ${pushPromises.length}`);
//           request.log.info(`[PUSH] Successful: ${successful}`);
//           request.log.info(`[PUSH] Failed: ${failed}`);
//           request.log.info(`[PUSH] ===============================================`);
          
//           // Log failed results for debugging
//           results.forEach((result, index) => {
//             if (result.status === 'rejected') {
//               request.log.error(`[PUSH] Promise ${index} rejected:`, result.reason);
//             } else if (result.status === 'fulfilled' && !result.value?.success) {
//               request.log.warn(`[PUSH] Promise ${index} failed:`, result.value);
//             }
//           });
//         } else {
//           request.log.warn(`[PUSH] No push notifications to send - check member data and FCM tokens`);
//         }
//       } catch (error) {
//         request.log.error(`[PUSH] ❌ Error in push notification process:`, error);
//         request.log.error(`[PUSH] Error stack:`, error.stack);
//       }
//     });

//     reply.status(201).send(response);
//   } catch (error) {
//     try {
//       const files = (request.files as any[]) || [];
//       const uploadedFilenames = files.map((f) => f.filename).filter(Boolean);
//       if (uploadedFilenames.length) {
//         FileService.removeFiles(uploadedFilenames);
//       }
//     } catch (_) {}
//     request.log.error(error);

//     if (error.message === "Conversation not found or you don't have access to it") {
//       return reply.status(404).send({
//         success: false,
//         message: error.message,
//       });
//     }

//     return reply.status(500).send({
//       success: false,
//       message: "Failed to send message",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };



export const sendMessage = async (request, reply) => {
  try {
    const { conversationId, userId, text } = request.body;
    const prisma = request.server.prisma;


    // validate request body
    const requiredFields = ["conversationId", "userId"];
    const missing = requiredFields.find(f => !request.body[f]);
    if (missing) {
      return reply.status(400).send({
        success: false,
        message: `${missing} is required`,
      });
    }
    
    const userIdInt = parseInt(userId);

    const files = request.files;

    if ((!text || text.trim() === "") && files.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "Either text or at least one file is required!",
      });
    }

    // Check if conversation exists and if user is blocked (for private conversations)
    const conversationCheck = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          where: { isDeleted: false },
          select: { userId: true },
        },
      },
    });

    if (!conversationCheck) {
      return reply.status(404).send({
        success: false,
        message: "Conversation not found",
      });
    }

    // Block check for private conversations only
    if (!conversationCheck.isGroup) {
      const otherMember = conversationCheck.members.find((m) => m.userId !== userIdInt);
      if (otherMember?.userId) {
        const isBlocked = await prisma.block.findFirst({
          where: {
            OR: [
              { blockerId: userIdInt, blockedId: otherMember.userId },
              { blockerId: otherMember.userId, blockedId: userIdInt },
            ],
          },
        });
        if (isBlocked) {
          return reply.status(403).send({
            success: false,
            message: "Cannot send message. User is blocked.",
          });
        }
      }
    }

    // Create message and get conversation members
    const transactionResult = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          members: { some: { userId: userIdInt, isDeleted: false } },
        },
        select: {
          id: true,
          isGroup: true,
          name: true,
          allowMemberMessage: true,
        },
      });

      if (!conversation) {
        throw new Error("Conversation not found or you don't have access to it");
      }

      const filesCreate = files.length > 0
        ? files.map((file) => ({
            userId: userIdInt,
            fileUrl: file.filename,
            fileType: file.mimetype || null,
            fileSize: typeof file.size === "number" ? file.size : null,
            fileExtension: path.extname(file.originalname || "").replace(".", "") || null,
          }))
        : [];

      const [message, members] = await Promise.all([
        tx.message.create({
          data: {
            text: text?.trim() || null,
            userId: userIdInt,
            conversationId,
            isRead: false,
            isDelivered: false,
            ...(filesCreate.length > 0 ? { MessageFile: { create: filesCreate } } : {}),
          },
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
            MessageFile: true,
          },
        }),
        tx.conversationMember.findMany({
          where: { conversationId, isDeleted: false },
          select: {
            userId: true,
            isAdmin: true,
            isMute: true,
            user: { 
              select: { 
                id: true, 
                fcmToken: true 
              } 
            },
          },
        }),
      ]);

      // Update conversation timestamp separately
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return { message, members, conversation };
    });

    // Log member data for debugging
    request.log.info(`[DEBUG] Transaction completed. Members count: ${transactionResult.members.length}`);
    transactionResult.members.forEach((m) => {
      request.log.info(`[DEBUG] Member ${m.userId}: isMute=${m.isMute}, hasUser=${!!m.user}, fcmTokens=${m.user?.fcmToken?.length || 0}`);
    });

    const participantIds = transactionResult.members
      .map((m) => m.userId)
      .filter((id): id is number => typeof id === "number");

    // Check if any recipient (not sender) is in conversation room
    let messageForResponse = transactionResult.message;
    let wasMarkedAsRead = false;
    
    if (request.server.getUsersInConversationRoom && request.server.isUserInConversationRoom) {
      const usersInRoom = request.server.getUsersInConversationRoom(conversationId);
      
      // Check if any recipient is in room
      const hasRecipientInRoom = transactionResult.members.some((member) => {
        if (!member.userId || member.userId === userIdInt) return false;
        return request.server.isUserInConversationRoom(member.userId.toString(), conversationId);
      });

      // Mark as read/delivered if any recipient is in room
      if (hasRecipientInRoom) {
        try {
          const updateResult = await prisma.message.update({
            where: { id: transactionResult.message.id },
            data: { isRead: true, isDelivered: true },
            include: {
              user: { select: { id: true, name: true, email: true, avatar: true } },
              MessageFile: true,
            },
          });
          messageForResponse = updateResult;
          wasMarkedAsRead = true;
        } catch (error) {
          request.log.error(error);
        }
      }
    }

    const transformedMessage = transformMessage(messageForResponse, participantIds);

    const response = {
      success: true,
      message: "Message sent successfully",
      data: transformedMessage,
    };

    // Send notifications asynchronously
    setImmediate(async () => {
      try {
        request.log.info(`[PUSH] ========== Starting push notification process ==========`);
        request.log.info(`[PUSH] Conversation ID: ${conversationId}, Sender: ${userIdInt}`);
        request.log.info(`[PUSH] Total members: ${transactionResult.members.length}`);
        request.log.info(`[PUSH] sendDataPush available: ${!!request.server.sendDataPush}`);
        const pushPromises: Promise<any>[] = [];

        // Emit read/delivered status if message was marked
        if (wasMarkedAsRead) {
          const statusData = {
            success: true,
            conversationId,
            markedBy: userIdInt,
            markedAsRead: true,
            isDelivered: true,
            messageId: messageForResponse.id,
          };

          transactionResult.members.forEach((member) => {
            if (member.userId) {
              request.server.io.to(member.userId.toString()).emit("messages_marked_read", statusData);
              request.server.io.to(member.userId.toString()).emit("message_delivered", statusData);
            }
          });
        }

        // Send socket events to all members (including muted)
        transactionResult.members.forEach((member) => {
          if (member.userId && member.userId !== userIdInt) {
            request.server.io.to(member.userId.toString()).emit("new_message", response);
          }
        });

         

        // Send push notifications only to non-muted members
        if (!request.server.sendDataPush) {
          request.log.warn("[PUSH] sendDataPush method not available on server instance");
          return;
        }

        request.log.info(`[PUSH] sendDataPush method is available, processing ${transactionResult.members.length} members`);

        for (const member of transactionResult.members) {
          if (member.userId === userIdInt) {
            request.log.info(`[PUSH] Skipping sender ${member.userId}`);
            continue;
          }
          
          request.log.info(`[PUSH] Processing member ${member.userId}, isMute: ${member.isMute}`);
          
          // Skip push notification if member has muted the conversation
          if (member.isMute) {
            request.log.info(`[PUSH] Skipping push notification for muted member ${member.userId}`);
            continue;
          }

          // Check if user data exists
          if (!member.user) {
            request.log.warn(`[PUSH] No user data found for member ${member.userId} - fetching from database`);
            // Try to fetch user data if not loaded
            try {
              const userData = await prisma.user.findUnique({
                where: { id: member.userId },
                select: { id: true, fcmToken: true },
              });
              if (!userData) {
                request.log.warn(`[PUSH] User ${member.userId} not found in database`);
                continue;
              }
              member.user = userData;
            } catch (err) {
              request.log.error(`[PUSH] Error fetching user data for ${member.userId}:`, err);
              continue;
            }
          }

          const fcmTokens = getJsonArray<string>(member.user?.fcmToken, []);
          request.log.info(`[PUSH] Member ${member.userId} has ${fcmTokens.length} FCM token(s)`);
          
          if (fcmTokens.length === 0) {
            request.log.warn(`[PUSH] No FCM tokens found for member ${member.userId}`);
            continue;
          }

          const validTokens = fcmTokens.filter((token): token is string => typeof token === 'string' && token.trim().length > 0);
          if (validTokens.length === 0) {
            request.log.warn(`[PUSH] No valid FCM tokens for member ${member.userId}`);
            continue;
          }

          request.log.info(`[PUSH] Sending push notification to member ${member.userId} (${validTokens.length} token(s))`);

          // Prepare push data - all values must be strings (sendDataPush will stringify the entire object)
          const pushData: Record<string, string> = {
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

          request.log.info(`[PUSH] Push data prepared for member ${member.userId}:`, JSON.stringify(pushData, null, 2));

          for (const token of validTokens) {
            request.log.info(`[PUSH] Attempting to send push to token: ${token.substring(0, 20)}...`);
            pushPromises.push(
              request.server.sendDataPush(token, pushData)
                .then((result) => {
                  if (result.success) {
                    request.log.info(`[PUSH] ✅ Push notification sent successfully to member ${member.userId}, messageId: ${result.messageId}`);
                  } else {
                    request.log.warn(`[PUSH] ❌ Push notification failed for member ${member.userId}: ${result.error || "Unknown error"}, code: ${result.code || "N/A"}`);
                  }
                  if (!result.success && result.shouldRemoveToken && member.userId) {
                    request.log.info(`[PUSH] Removing invalid token for member ${member.userId}`);
                    prisma.user.update({
                      where: { id: member.userId },
                      data: {
                        fcmToken: validTokens.filter((t) => t !== token),
                      },
                    }).catch((err) => {
                      request.log.error(`[PUSH] Failed to remove invalid token for user ${member.userId}: ${err.message}`);
                    });
                  }
                  return result;
                })
                .catch((error) => {
                  request.log.error(`[PUSH] ❌ Push notification error for member ${member.userId}: ${error.message || error}`, error);
                  return { success: false, error: error.message || "Unknown error" };
                })
            );
          }
        }

        request.log.info(`[PUSH] Total push promises: ${pushPromises.length}`);
        if (pushPromises.length > 0) {
          const results = await Promise.allSettled(pushPromises);
          const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
          const failed = results.length - successful;
          request.log.info(`[PUSH] ========== Push notification summary ==========`);
          request.log.info(`[PUSH] Total attempts: ${pushPromises.length}`);
          request.log.info(`[PUSH] Successful: ${successful}`);
          request.log.info(`[PUSH] Failed: ${failed}`);
          request.log.info(`[PUSH] ===============================================`);
          
          // Log failed results for debugging
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              request.log.error(`[PUSH] Promise ${index} rejected:`, result.reason);
            } else if (result.status === 'fulfilled' && !result.value?.success) {
              request.log.warn(`[PUSH] Promise ${index} failed:`, result.value);
            }
          });
        } else {
          request.log.warn(`[PUSH] No push notifications to send - check member data and FCM tokens`);
        }
      } catch (error) {
        request.log.error(`[PUSH] ❌ Error in push notification process:`, error);
        request.log.error(`[PUSH] Error stack:`, error.stack);
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

    // Handle JSON array - ensure it's an array
    const deletedUsers = getJsonArray<number>(message.deletedForUsers);
    
    if (jsonArrayContains(message.deletedForUsers, myIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Message already deleted for you",
      });
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        deletedForUsers: jsonArrayAdd<number>(message.deletedForUsers, myIdInt),
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

    // Fetch messages - MySQL JSON doesn't support { has: ... } filter
    // We'll fetch more and filter in code, then paginate
    const allRows = await prisma.message.findMany({
      where: {
        conversationId,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        MessageFile: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Filter out messages deleted for this user (handle JSON array)
    const rows = allRows.filter((message) => {
      return !jsonArrayContains(message.deletedForUsers, myIdInt);
    });

    // Apply pagination after filtering
    const hasMore = rows.length > offset + perPage;
    const pageRows = rows.slice(offset, offset + perPage);

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