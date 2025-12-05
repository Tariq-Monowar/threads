import fp from "fastify-plugin";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { FileService } from "../utils/fileService";
const prisma = new PrismaClient();

type CallType = "audio" | "video";
type CallStatus = "calling" | "in_call";

interface CallData {
  with: string;
  status: CallStatus;
  type: CallType;
}

// ICE candidate buffer interface
interface ICECandidateBuffer {
  candidate: RTCIceCandidate;
  timestamp: number;
}

export default fp(async (fastify) => {
  const io = new Server(fastify.server, {
    cors: {
      origin: [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:50468",
        "http://localhost:4002",
        "http://127.0.0.1:5500",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  //state
  // Support multiple sockets per user (multiple tabs, reconnects)
  // Map<userId, Set<socketId>>
  const onlineUsers = new Map<string, Set<string>>();
  const activeCalls = new Map<string, CallData>();
  //---------------------------------------------------
  const callHistoryMap = new Map<string, string>();

  // Conversation room tracking: Map<conversationId, Set<userId>>
  const conversationRooms = new Map<string, Set<string>>();

  // ICE candidate buffering: Map<"userId-peerId", ICECandidateBuffer[]>
  // This prevents race condition where ICE candidates arrive before remote description
  const iceCandidateBuffers = new Map<string, ICECandidateBuffer[]>();

  // Helper: Get or create ICE buffer
  const getIceCandidateBuffer = (
    userId: string,
    peerId: string
  ): ICECandidateBuffer[] => {
    const key = `${userId}-${peerId}`;
    if (!iceCandidateBuffers.has(key)) {
      iceCandidateBuffers.set(key, []);
    }
    return iceCandidateBuffers.get(key)!;
  };

  // Helper: Clear ICE buffer
  const clearIceCandidateBuffer = (userId: string, peerId: string) => {
    const key = `${userId}-${peerId}`;
    iceCandidateBuffers.delete(key);
    // Also clear reverse direction
    const reverseKey = `${peerId}-${userId}`;
    iceCandidateBuffers.delete(reverseKey);
  };

  // Helper: Cleanup old ICE candidates (older than 30 seconds)
  const cleanupOldIceCandidates = () => {
    const now = Date.now();
    const maxAge = 30000; // 30 seconds

    for (const [key, buffer] of iceCandidateBuffers.entries()) {
      const filtered = buffer.filter((item) => now - item.timestamp < maxAge);
      if (filtered.length === 0) {
        iceCandidateBuffers.delete(key);
      } else if (filtered.length !== buffer.length) {
        iceCandidateBuffers.set(key, filtered);
      }
    }
  };

  // Cleanup old ICE candidates every 10 seconds
  setInterval(cleanupOldIceCandidates, 10000);

  // Helper: Check if user is in conversation room
  const isUserInConversationRoom = (
    userId: string,
    conversationId: string
  ): boolean => {
    const room = conversationRooms.get(conversationId);
    if (!room) {
      fastify.log.debug(`Room ${conversationId} does not exist`);
      return false;
    }
    const isInRoom = room.has(userId);
    if (!isInRoom) {
      fastify.log.debug(
        `User ${userId} not in room ${conversationId}. Room has: [${Array.from(
          room
        ).join(", ")}]`
      );
    }
    return isInRoom;
  };

  // Helper: Join conversation room
  const joinConversationRoom = (userId: string, conversationId: string) => {
    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
    }
    const room = conversationRooms.get(conversationId)!;
    const wasAlreadyInRoom = room.has(userId);
    room.add(userId);

    if (!wasAlreadyInRoom) {
      fastify.log.info(
        `➕ User ${userId} joined conversation room ${conversationId}. Room now has ${room.size} user(s)`
      );
    } else {
      fastify.log.debug(
        `User ${userId} already in conversation room ${conversationId}`
      );
    }
  };

  // Helper: Leave conversation room
  const leaveConversationRoom = (userId: string, conversationId: string) => {
    const room = conversationRooms.get(conversationId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        conversationRooms.delete(conversationId);
      }
      fastify.log.info(
        `User ${userId} left conversation room ${conversationId}`
      );
    }
  };

  // Helper: Get all users in a conversation room
  const getUsersInConversationRoom = (conversationId: string): string[] => {
    const room = conversationRooms.get(conversationId);
    const users = room ? Array.from(room) : [];
    // Log at info level for debugging room issues
    fastify.log.info(
      `🔍 Room ${conversationId} has ${users.length} user(s): [${users.join(
        ", "
      )}]`
    );
    return users;
  };

  // Helper function to save call history
  const saveCallHistory = async (
    callerId: number,
    receiverId: number,
    type: "AUDIO" | "VIDEO",
    status: "ONGOING" | "COMPLETED" | "MISSED" | "DECLINED" | "CANCELED",
    conversationId?: string,
    startedAt?: Date,
    endedAt?: Date
  ): Promise<string | null> => {
    try {
      if (!fastify.prisma) {
        fastify.log.warn("Prisma client not available for call history");
        return null;
      }

      const callData: any = {
        callerId,
        receiverId,
        type,
        status,
        participantIds: [],
      };

      if (conversationId) {
        callData.conversationId = conversationId;
      }

      if (startedAt) {
        callData.startedAt = startedAt;
      }

      if (endedAt) {
        callData.endedAt = endedAt;
      }

      const call = await (fastify.prisma as any).call.create({
        data: callData,
      });

      return call.id;
    } catch (error: any) {
      fastify.log.error(`Failed to save call history: ${error.message}`);
      return null;
    }
  };

  // Helper function to update call history
  const updateCallHistory = async (
    callId: string,
    status: "ONGOING" | "COMPLETED" | "MISSED" | "DECLINED" | "CANCELED",
    endedAt?: Date
  ): Promise<void> => {
    try {
      if (!fastify.prisma) {
        return;
      }

      const updateData: any = { status };
      if (endedAt) {
        updateData.endedAt = endedAt;
      }

      await (fastify.prisma as any).call.update({
        where: { id: callId },
        data: updateData,
      });
    } catch (error: any) {
      fastify.log.error(`Failed to update call history: ${error.message}`);
    }
  };
  //---------------------------------------------------

  io.on("connection", (socket) => {
    // // TURN/STUN server configuration
    // const iceServers = [
    //   { urls: "stun:31.97.236.206:3478" },
    //   {
    //     urls: "turn:31.97.236.206:3478",
    //     username: "webrtc",
    //     credential: "password123",
    //   },
    // ];

    fastify.log.info(`New socket connected: ${socket.id}`);

    // Helper: Get userId from socket (supports multiple sockets per user)
    const getUserId = (): string | null => {
      for (const [userId, socketIds] of onlineUsers.entries()) {
        const socketSet: Set<string> = socketIds;
        if (socketSet.has(socket.id)) return userId;
      }
      return null;
    };

    // 1. User Join
    socket.on("join", (userId: string) => {
      if (!userId) {
        fastify.log.warn(
          `Invalid join event: userId is empty, socket: ${socket.id}`
        );
        return;
      }

      // Add socket.id to user's socket set (supports multiple tabs/sockets)
      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set<string>());
      }
      const userSocketSet: Set<string> = onlineUsers.get(userId)!;
      const wasAlreadyAdded = userSocketSet.has(socket.id);
      userSocketSet.add(socket.id);
      socket.join(userId);

      const socketCount: number = userSocketSet.size;
      if (wasAlreadyAdded) {
        fastify.log.debug(
          `User ${userId} socket ${socket.id} already registered (total sockets: ${socketCount})`
        );
      } else {
        fastify.log.info(
          `✅ User ${userId} joined with socket ${socket.id} (total sockets: ${socketCount})`
        );
      }

      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // 2. Typing Indicators (based on conversation rooms)
    socket.on(
      "start_typing",
      ({
        conversationId,
        userId,
        userName,
      }: {
        conversationId: string;
        userId?: string;
        userName?: string;
      }) => {
        if (!conversationId) {
          fastify.log.warn(`Invalid start_typing: missing conversationId`);
          return;
        }

        // Get userId from socket (more secure than trusting client)
        const actualUserId = userId || getUserId();
        if (!actualUserId) {
          fastify.log.warn(
            `Invalid start_typing: userId not found for socket ${socket.id}`
          );
          return;
        }

        const userIdStr = actualUserId.toString();
        fastify.log.debug(
          `start_typing: conversationId=${conversationId}, userId=${userIdStr}, socket=${socket.id}`
        );

        // Verify user is in the conversation room
        if (!isUserInConversationRoom(userIdStr, conversationId)) {
          const usersInRoom = getUsersInConversationRoom(conversationId);
          fastify.log.warn(
            `User ${userIdStr} attempted to send typing indicator but is not in conversation ${conversationId}. ` +
              `Users in room: [${usersInRoom.join(
                ", "
              )}], Socket userId: ${actualUserId}`
          );
          return;
        }

        // Get all users in the conversation room using the conversation room system
        const usersInRoom = getUsersInConversationRoom(conversationId);
        fastify.log.debug(
          `Typing indicator: User ${userIdStr} typing in ${conversationId}, room has ${usersInRoom.length} user(s)`
        );

        // Emit to all members in the conversation room (except sender)
        usersInRoom.forEach((memberUserId) => {
          if (memberUserId !== userIdStr) {
            io.to(memberUserId).emit("start_typing", {
              conversationId,
              userId: userIdStr,
              userName,
              isTyping: true,
            });
          }
        });
      }
    );

    socket.on(
      "stop_typing",
      ({
        conversationId,
        userId,
        userName,
      }: {
        conversationId: string;
        userId?: string;
        userName?: string;
      }) => {
        if (!conversationId) {
          fastify.log.warn(`Invalid stop_typing: missing conversationId`);
          return;
        }

        // Get userId from socket (more secure than trusting client)
        const actualUserId = userId || getUserId();
        if (!actualUserId) {
          fastify.log.warn(
            `Invalid stop_typing: userId not found for socket ${socket.id}`
          );
          return;
        }

        const userIdStr = actualUserId.toString();
        fastify.log.debug(
          `stop_typing: conversationId=${conversationId}, userId=${userIdStr}, socket=${socket.id}`
        );

        // Verify user is in the conversation room
        if (!isUserInConversationRoom(userIdStr, conversationId)) {
          const usersInRoom = getUsersInConversationRoom(conversationId);
          fastify.log.warn(
            `User ${userIdStr} attempted to send stop typing indicator but is not in conversation ${conversationId}. ` +
              `Users in room: [${usersInRoom.join(
                ", "
              )}], Socket userId: ${actualUserId}`
          );
          return;
        }

        // Get all users in the conversation room using the conversation room system
        const usersInRoom = getUsersInConversationRoom(conversationId);
        fastify.log.debug(
          `Stop typing indicator: User ${userIdStr} stopped typing in ${conversationId}, room has ${usersInRoom.length} user(s)`
        );

        // Emit to all members in the conversation room (except sender)
        usersInRoom.forEach((memberUserId) => {
          if (memberUserId !== userIdStr) {
            io.to(memberUserId).emit("stop_typing", {
              conversationId,
              userId: userIdStr,
              userName,
              isTyping: false,
            });
          }
        });
      }
    );

    // 3. Get online users
    socket.on("get_online_users", () => {
      socket.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // 4. Join Conversation Room
    socket.on(
      "join_conversation",
      async ({
        conversationId,
        userId,
      }: {
        conversationId: string;
        userId: string;
      }) => {
        if (!conversationId || !userId) {
          fastify.log.warn(
            `Invalid join_conversation request: conversationId=${conversationId}, userId=${userId}`
          );
          return;
        }

        // Check if user is online (has any active sockets)
        const userSockets: Set<string> | undefined = onlineUsers.get(userId);

        // If user is not in onlineUsers, they need to call "join" event first
        if (!userSockets || userSockets.size === 0) {
          fastify.log.warn(
            `⚠️ User ${userId} attempted to join conversation ${conversationId} but is not online. User must call "join" event first. Online users: [${Array.from(
              onlineUsers.keys()
            ).join(", ")}]`
          );
          // Still allow them to join the room (they might be connecting)
          // But log a warning
        } else if (!userSockets.has(socket.id)) {
          // User is online but this specific socket is not registered
          // This can happen with multiple tabs - we'll still allow the join
          fastify.log.info(
            `ℹ️ User ${userId} joining conversation ${conversationId} with socket ${socket.id} (not in user's socket set, but user is online with ${userSockets.size} socket(s))`
          );
          // Add this socket to user's set
          userSockets.add(socket.id);
          socket.join(userId);
        }

        // Ensure userId is a string for consistency
        const userIdStr = userId.toString();

        // Join the conversation room (always allow, even if socket wasn't registered)
        joinConversationRoom(userIdStr, conversationId);
        socket.join(`conversation:${conversationId}`);

        // Verify join was successful
        const usersInRoom = getUsersInConversationRoom(conversationId);
        const isInRoom = isUserInConversationRoom(userIdStr, conversationId);
        fastify.log.info(
          `✅ User ${userIdStr} (socket: ${socket.id}) joined conversation ${conversationId}. ` +
            `Total users in room: ${usersInRoom.length} [${usersInRoom.join(
              ", "
            )}], ` +
            `Verification: ${isInRoom ? "CONFIRMED" : "FAILED"}`
        );

        socket.emit("conversation_joined", {
          conversationId,
          userId: userIdStr,
        });

        // Mark messages from OTHER members as read when user joins (async, non-blocking)
        setImmediate(async () => {
          try {
            if (!fastify.prisma) {
              fastify.log.warn(
                "Prisma client not available for marking messages as read"
              );
              return;
            }

            // Double-check user is still connected before marking as read
            const userSockets: Set<string> | undefined =
              onlineUsers.get(userId);
            if (!userSockets || !userSockets.has(socket.id)) {
              fastify.log.warn(
                `User ${userId} disconnected before marking messages as read`
              );
              return;
            }

            const userIdInt = parseInt(userId);
            if (Number.isNaN(userIdInt)) {
              fastify.log.warn(
                `Invalid userId for marking messages as read: ${userId}`
              );
              return;
            }

            // Filter: Only find unread messages from OTHER members (NOT from the user who joined)
            const unreadMessages = await (
              fastify.prisma as any
            ).message.findMany({
              where: {
                conversationId,
                isRead: false,
                NOT: {
                  userId: userIdInt, // Critical filter: exclude sender's own messages
                },
              },
              select: {
                id: true,
              },
            });

            if (unreadMessages.length === 0) {
              return; // No unread messages to mark
            }

            // Update: Only mark messages from other members as read and delivered
            await (fastify.prisma as any).message.updateMany({
              where: {
                conversationId,
                isRead: false,
                NOT: {
                  userId: userIdInt, // Critical filter: only messages from other members
                },
              },
              data: {
                isRead: true,
                isDelivered: true, // If message is read, it must be delivered
              },
            });

            // Get all conversation members to notify them
            const members = await fastify.prisma.conversationMember.findMany({
              where: {
                conversationId,
                isDeleted: false,
              },
              select: {
                userId: true,
              },
            });

            // Emit to other members only (exclude the user who joined)
            const readStatusData = {
              success: true,
              conversationId,
              markedBy: userIdInt,
              markedAsRead: true,
            };

            members.forEach((member) => {
              if (member.userId && member.userId !== userIdInt) {
                io.to(member.userId.toString()).emit(
                  "messages_marked_read",
                  readStatusData
                );
              }
            });

            fastify.log.info(
              `Marked ${unreadMessages.length} messages as read for user ${userId} in conversation ${conversationId}`
            );
          } catch (error: any) {
            fastify.log.error(
              `Failed to mark messages as read on join: ${error.message}`
            );
          }
        });
      }
    );

    // 5. Leave Conversation Room
    socket.on(
      "leave_conversation",
      ({
        conversationId,
        userId,
      }: {
        conversationId: string;
        userId: string;
      }) => {
        if (!conversationId || !userId) return;

        leaveConversationRoom(userId, conversationId);
        socket.leave(`conversation:${conversationId}`);
        socket.emit("conversation_left", { conversationId });
        fastify.log.info(
          `Socket ${socket.id}: User ${userId} left conversation ${conversationId}`
        );
      }
    );

    // 6. Call Initiate (A calls B)
    socket.on(
      "call_initiate",
      async ({
        callerId,
        receiverId,
        callType = "audio",
        callerName,
        callerAvatar,
      }: {
        callerId: string;
        receiverId: string;
        callType?: CallType;
        callerName?: string;
        callerAvatar?: string;
      }) => {
        if (!callerId || !receiverId) return;

        // if (!onlineUsers.has(receiverId)) {
        //   socket.emit("call_failed", { message: "User is offline" });
        //   return;
        // }

        if (activeCalls.has(receiverId)) {
          socket.emit("call_busy", { message: "User is busy" });
          return;
        }

        const callerIdNumber = Number(callerId);
        const receiverIdNumber = Number(receiverId);

        if (Number.isNaN(callerIdNumber) || Number.isNaN(receiverIdNumber)) {
          socket.emit("call_failed", { message: "Invalid user id" });
          fastify.log.warn(
            `Call aborted: non-numeric ids caller=${callerId} receiver=${receiverId}`
          );
          return;
        }

        let usersData;
        try {
          usersData = await prisma.user.findMany({
            where: {
              id: { in: [callerIdNumber, receiverIdNumber] },
            },
            select: {
              id: true,
              name: true,
              avatar: true,
              fcmToken: true,
            },
          });
        } catch (error: any) {
          fastify.log.error(
            `Failed to fetch caller info for ${callerId}: ${error.message}`
          );
          socket.emit("call_failed", {
            message: "Failed to retrieve user info",
          });
          return;
        }

        // Extract caller and receiver info from results
        const callerInfoFromDb = usersData.find((u) => u.id === callerIdNumber);
        const receiverData = usersData.find((u) => u.id === receiverIdNumber);

        const callerInfo = callerInfoFromDb || {
          id: callerIdNumber,
          name: callerName || `User ${callerId}`,
          avatar: callerAvatar || null,
        };

        const receiverFcmTokens = receiverData?.fcmToken || [];

        // Send push only to receiver (via FCM tokens)
        if (receiverFcmTokens.length > 0) {
          const pushData = {
            type: "call_initiate", // Changed from "november_is_comming" to meaningful type
            callerId,
            callType,
            callerInfo: {
              ...callerInfo,
              avatar: FileService.avatarUrl(callerInfo.avatar || ""),
            },
          };

          const pushPromises: Promise<any>[] = [];

          // Use receiverFcmTokens instead of member.user?.fcmToken
          if (
            Array.isArray(receiverFcmTokens) &&
            receiverFcmTokens.length > 0
          ) {
            const validTokens = receiverFcmTokens.filter(
              (token): token is string => Boolean(token)
            );

            // Add all push promises to array for parallel execution
            for (const token of validTokens) {
              pushPromises.push(
                fastify.sendDataPush(token, pushData).catch((error) => {
                  fastify.log.warn(
                    { token, error: error?.message || error },
                    "Call push notification failed"
                  );
                  return { success: false, error };
                })
              );
            }

            // Execute all push promises in parallel
            if (pushPromises.length > 0) {
              Promise.allSettled(pushPromises)
                .then((results) => {
                  const failed = results.filter(
                    (result) => result.status === "rejected"
                  );
                  if (failed.length > 0) {
                    fastify.log.warn(
                      `Call push notifications failed for ${failed.length}/${validTokens.length} tokens to ${receiverId}`
                    );
                  }
                })
                .catch((err) => {
                  fastify.log.error(
                    `Error handling call push promises for ${receiverId}: ${err.message}`
                  );
                });
            }
          }
        }

        // Mark both as calling
        activeCalls.set(callerId, {
          with: receiverId,
          status: "calling",
          type: callType,
        });
        activeCalls.set(receiverId, {
          with: callerId,
          status: "calling",
          type: callType,
        });

        //---------------------------------------------------
        // Save call history
        const callKey = `${callerId}-${receiverId}`;
        const callTypeEnum = callType.toUpperCase() as "AUDIO" | "VIDEO";
        const callId = await saveCallHistory(
          callerIdNumber,
          receiverIdNumber,
          callTypeEnum,
          "ONGOING",
          undefined,
          new Date()
        );
        if (callId) {
          callHistoryMap.set(callKey, callId);
          callHistoryMap.set(`${receiverId}-${callerId}`, callId);
        }
        //---------------------------------------------------
        // Clear any old ICE candidate buffers for this call
        clearIceCandidateBuffer(callerId, receiverId);
        // Emit to all sockets of the receiver (supports multiple tabs)
        const receiverSockets: Set<string> | undefined =
          onlineUsers.get(receiverId);
        if (receiverSockets && receiverSockets.size > 0) {
          io.to(receiverId).emit("call_incoming", {
            callerId,
            callType,
            callerInfo: {
              ...callerInfo,
              avatar: FileService.avatarUrl(callerInfo?.avatar || ""),
            },
          });
        }

        fastify.log.info(`${callerId} calling ${receiverId} (${callType})`);
      }
    );

    // 7. Call Accept
    socket.on(
      "call_accept",
      ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
        const callerIdLocal = callerId;
        const calleeId = receiverId;

        const callData = activeCalls.get(callerIdLocal);
        if (!callData || callData.with !== calleeId) return;

        // Update status to in_call
        activeCalls.set(callerIdLocal, { ...callData, status: "in_call" });
        activeCalls.set(calleeId, {
          with: callerIdLocal,
          status: "in_call",
          type: callData.type,
        });

        // Update call history status to ONGOING
        const callKey = `${callerIdLocal}-${calleeId}`;
        const callId = callHistoryMap.get(callKey);
        if (callId) {
          updateCallHistory(callId, "ONGOING").catch((error) => {
            fastify.log.error(
              `Failed to update call history on accept: ${error.message}`
            );
          });
        }

        // Emit to all sockets of the caller
        const callerSockets = onlineUsers.get(callerIdLocal);
        if (callerSockets && callerSockets.size > 0) {
          io.to(callerIdLocal).emit("call_accepted", {
            receiverId: calleeId,
            callType: callData.type,
          });
        }

        fastify.log.info(`Call accepted: ${callerIdLocal} ↔ ${calleeId}`);
      }
    );

    // 8. WebRTC Offer (SDP Offer)
    socket.on(
      "webrtc_offer",
      ({
        receiverId,
        sdp,
      }: {
        receiverId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const senderId = getUserId();
        if (!senderId || !receiverId) return;

        fastify.log.info(`📤 WebRTC Offer from ${senderId} to ${receiverId}`);

        // When offer is sent, clear any buffered ICE candidates for this direction
        // The receiver will buffer new candidates until they process this offer
        const bufferKey = `${receiverId}-${senderId}`;
        const existingBuffer = iceCandidateBuffers.get(bufferKey);
        if (existingBuffer && existingBuffer.length > 0) {
          fastify.log.info(
            `🗑️ Clearing ${existingBuffer.length} old ICE candidates for ${bufferKey}`
          );
          iceCandidateBuffers.delete(bufferKey);
        }

        // Emit to all sockets of the receiver
        const receiverSockets = onlineUsers.get(receiverId);
        if (receiverSockets && receiverSockets.size > 0) {
          io.to(receiverId).emit("webrtc_offer", { senderId, sdp });
        }
      }
    );

    // 9. WebRTC Answer (SDP Answer)
    socket.on(
      "webrtc_answer",
      ({
        callerId,
        sdp,
      }: {
        callerId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const senderId = getUserId();
        if (!senderId || !callerId) return;

        fastify.log.info(`📥 WebRTC Answer from ${senderId} to ${callerId}`);

        // When answer is sent, send any buffered ICE candidates to the caller
        const bufferKey = `${callerId}-${senderId}`;
        const bufferedCandidates = iceCandidateBuffers.get(bufferKey);

        // Emit answer first
        const callerSockets: Set<string> | undefined =
          onlineUsers.get(callerId);
        if (callerSockets && callerSockets.size > 0) {
          io.to(callerId).emit("webrtc_answer", { callerId, sdp });

          // Then send buffered ICE candidates if any
          if (bufferedCandidates && bufferedCandidates.length > 0) {
            fastify.log.info(
              `📦 Flushing ${bufferedCandidates.length} buffered ICE candidates to ${callerId}`
            );

            bufferedCandidates.forEach((item) => {
              io.to(callerId).emit("webrtc_ice", {
                senderId,
                candidate: item.candidate,
              });
            });

            // Clear the buffer after flushing
            iceCandidateBuffers.delete(bufferKey);
          }
        }
      }
    );

    // 10. ICE Candidate (with buffering to prevent race conditions)
    socket.on(
      "webrtc_ice",
      ({
        receiverId,
        candidate,
      }: {
        receiverId: string;
        candidate: RTCIceCandidate;
      }) => {
        const senderId = getUserId();
        if (!senderId || !receiverId) return;

        // Check if there's an active call between these users
        const senderCall = activeCalls.get(senderId);
        const receiverCall = activeCalls.get(receiverId);

        if (
          !senderCall ||
          !receiverCall ||
          senderCall.with !== receiverId ||
          receiverCall.with !== senderId
        ) {
          fastify.log.warn(
            `⚠️ ICE candidate from ${senderId} to ${receiverId} but no active call`
          );
          return;
        }

        const receiverSockets = onlineUsers.get(receiverId);
        if (!receiverSockets || receiverSockets.size === 0) {
          fastify.log.warn(
            `⚠️ ICE candidate from ${senderId} to ${receiverId} but receiver offline`
          );
          return;
        }

        // Buffer ICE candidate instead of sending immediately
        // This prevents race condition where candidates arrive before remote description
        const buffer = getIceCandidateBuffer(receiverId, senderId);
        buffer.push({
          candidate,
          timestamp: Date.now(),
        });

        fastify.log.debug(
          `🧊 Buffered ICE candidate from ${senderId} to ${receiverId} (buffer size: ${buffer.length})`
        );

        // If call is already in "in_call" status, it means SDP exchange is complete
        // So we can send the candidate immediately
        if (
          senderCall.status === "in_call" &&
          receiverCall.status === "in_call"
        ) {
          fastify.log.debug(
            `✅ Call in progress, sending ICE candidate immediately to ${receiverId}`
          );
          io.to(receiverId).emit("webrtc_ice", { senderId, candidate });

          // Remove from buffer since we sent it
          buffer.pop();
        } else {
          fastify.log.debug(
            `⏳ Call still connecting, ICE candidate buffered for ${receiverId}`
          );
        }
      }
    );

    // New event: Flush buffered ICE candidates (called by client after setting remote description)
    socket.on("webrtc_ice_flush", ({ peerId }: { peerId: string }) => {
      const userId = getUserId();
      if (!userId || !peerId) return;

      const bufferKey = `${userId}-${peerId}`;
      const bufferedCandidates = iceCandidateBuffers.get(bufferKey);

      if (bufferedCandidates && bufferedCandidates.length > 0) {
        fastify.log.info(
          `🚀 Client ${userId} requested flush of ${bufferedCandidates.length} ICE candidates from ${peerId}`
        );

        // Send all buffered candidates
        bufferedCandidates.forEach((item) => {
          socket.emit("webrtc_ice", {
            senderId: peerId,
            candidate: item.candidate,
          });
        });

        // Clear the buffer
        iceCandidateBuffers.delete(bufferKey);
        fastify.log.info(`✅ Flushed and cleared ICE buffer for ${bufferKey}`);
      } else {
        fastify.log.debug(`No buffered ICE candidates for ${bufferKey}`);
      }
    });

    // 11. Call Decline
    socket.on(
      "call_decline",
      ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
        activeCalls.delete(callerId);
        activeCalls.delete(receiverId);

        // Clear ICE buffers
        clearIceCandidateBuffer(callerId, receiverId);

        // Update call history status to DECLINED
        const callKey = `${callerId}-${receiverId}`;
        const callId = callHistoryMap.get(callKey);
        if (callId) {
          updateCallHistory(callId, "DECLINED", new Date())
            .then(() => {
              callHistoryMap.delete(callKey);
              callHistoryMap.delete(`${receiverId}-${callerId}`);
            })
            .catch((error) => {
              fastify.log.error(
                `Failed to update call history on decline: ${error.message}`
              );
            });
        }

        // Emit to all sockets of the caller
        const callerSockets: Set<string> | undefined =
          onlineUsers.get(callerId);
        if (callerSockets && callerSockets.size > 0) {
          io.to(callerId).emit("call_declined", { receiverId });
        }
      }
    );

    // 12. Call End
    socket.on(
      "call_end",
      async ({
        callerId,
        receiverId,
      }: {
        callerId: string;
        receiverId: string;
      }) => {
        const endedByUserId = getUserId();
        if (!endedByUserId) return;

        const callerCall = activeCalls.get(callerId);
        const receiverCall = activeCalls.get(receiverId);

        if (
          callerCall &&
          callerCall.with === receiverId &&
          receiverCall &&
          receiverCall.with === callerId
        ) {
          const wasAccepted = callerCall.status === "in_call";
          const callType = callerCall.type;
          activeCalls.delete(callerId);
          activeCalls.delete(receiverId);

          // Clear ICE buffers
          clearIceCandidateBuffer(callerId, receiverId);

          const opponentId = endedByUserId === callerId ? receiverId : callerId;
          // Emit to all sockets of the opponent (except the current socket)
          const opponentSockets: Set<string> | undefined =
            onlineUsers.get(opponentId);
          if (opponentSockets && opponentSockets.size > 0) {
            // Emit to userId room, which will reach all sockets of that user
            io.to(opponentId).emit("call_ended", {
              endedBy: endedByUserId,
              reason: "ended_by_user",
            });
          }

          // Update call history status - COMPLETED if accepted, CANCELED if not
          const callKey = `${callerId}-${receiverId}`;
          const callId = callHistoryMap.get(callKey);
          if (callId) {
            const finalStatus = wasAccepted ? "COMPLETED" : "CANCELED";
            updateCallHistory(
              callId,
              finalStatus as "COMPLETED" | "CANCELED",
              new Date()
            )
              .then(() => {
                callHistoryMap.delete(callKey);
                callHistoryMap.delete(`${receiverId}-${callerId}`);
              })
              .catch((error) => {
                fastify.log.error(
                  `Failed to update call history on end: ${error.message}`
                );
              });
          }

          // Send push notification to opponent
          try {
            const callerIdNumber = Number(callerId);
            const receiverIdNumber = Number(receiverId);
            const opponentIdNumber = Number(opponentId);

            if (
              !Number.isNaN(callerIdNumber) &&
              !Number.isNaN(receiverIdNumber)
            ) {
              const usersData = await prisma.user.findMany({
                where: {
                  id: { in: [callerIdNumber, receiverIdNumber] },
                },
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                  fcmToken: true,
                },
              });

              const opponentData = usersData.find(
                (u) => u.id === opponentIdNumber
              );
              const endedByUserData = usersData.find(
                (u) => u.id === Number(endedByUserId)
              );

              if (
                opponentData &&
                opponentData.fcmToken &&
                opponentData.fcmToken.length > 0
              ) {
                const endedByUserInfo = endedByUserData
                  ? {
                      id: endedByUserData.id.toString(),
                      name: endedByUserData.name || `User ${endedByUserId}`,
                      avatar: FileService.avatarUrl(
                        endedByUserData.avatar || ""
                      ),
                    }
                  : null;

                const pushData: Record<string, string> = {
                  type: "call_ended",
                  endedBy: endedByUserId,
                  callType: callType,
                  reason: wasAccepted ? "completed" : "canceled",
                };

                if (endedByUserInfo) {
                  pushData.endedByUser = JSON.stringify(endedByUserInfo);
                }

                const pushPromises: Promise<any>[] = [];
                const validTokens = opponentData.fcmToken.filter(
                  (token): token is string => Boolean(token)
                );

                for (const token of validTokens) {
                  pushPromises.push(
                    fastify.sendDataPush(token, pushData).catch((error) => {
                      fastify.log.warn(
                        { token, error: error?.message || error },
                        "Call ended push notification failed"
                      );
                      return { success: false, error };
                    })
                  );
                }

                if (pushPromises.length > 0) {
                  Promise.allSettled(pushPromises)
                    .then((results) => {
                      const failed = results.filter(
                        (result) => result.status === "rejected"
                      );
                      if (failed.length > 0) {
                        fastify.log.warn(
                          `Call ended push notifications failed for ${failed.length}/${validTokens.length} tokens to ${opponentId}`
                        );
                      }
                    })
                    .catch((err) => {
                      fastify.log.error(
                        `Error handling call ended push promises for ${opponentId}: ${err.message}`
                      );
                    });
                }
              }
            }
          } catch (error: any) {
            fastify.log.error(
              `Failed to send call ended push notification: ${error.message}`
            );
          }

          fastify.log.info(
            `Call ended by ${endedByUserId}: ${callerId} ❌ ${receiverId}`
          );
        } else {
          fastify.log.warn(
            `Invalid call_end attempt by ${endedByUserId} for call ${callerId}-${receiverId}`
          );
        }
      }
    );

    // 13. Disconnect - Cleanup
    socket.on("disconnect", () => {
      const userId = getUserId();
      if (!userId) {
        fastify.log.info(`Socket ${socket.id} disconnected (no userId found)`);
        return;
      }

      // Remove this specific socket from user's socket set
      const userSockets: Set<string> | undefined = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        const remainingCount: number = userSockets.size;
        fastify.log.info(
          `Socket ${socket.id} removed from user ${userId}. Remaining sockets: ${remainingCount}`
        );

        // Only remove user from conversation rooms if this was their last socket
        if (remainingCount === 0) {
          // Remove user from all conversation rooms
          for (const [conversationId, room] of conversationRooms.entries()) {
            if (room.has(userId)) {
              leaveConversationRoom(userId, conversationId);
            }
          }
          // Remove user from onlineUsers completely
          onlineUsers.delete(userId);
          fastify.log.info(
            `User ${userId} fully disconnected (no remaining sockets)`
          );
        }
      }

      if (activeCalls.has(userId)) {
        const call = activeCalls.get(userId)!;
        const peerId = call.with;
        activeCalls.delete(userId);
        activeCalls.delete(peerId);

        // Clear ICE buffers
        clearIceCandidateBuffer(userId, peerId);

        // Update call history status to MISSED
        const callKey = `${userId}-${peerId}`;
        const callId =
          callHistoryMap.get(callKey) ||
          callHistoryMap.get(`${peerId}-${userId}`);
        if (callId) {
          updateCallHistory(callId, "MISSED", new Date())
            .then(() => {
              callHistoryMap.delete(callKey);
              callHistoryMap.delete(`${peerId}-${userId}`);
            })
            .catch((error) => {
              fastify.log.error(
                `Failed to update call history on disconnect: ${error.message}`
              );
            });
        }

        // Emit to all sockets of the peer
        const peerSockets: Set<string> | undefined = onlineUsers.get(peerId);
        if (peerSockets && peerSockets.size > 0) {
          io.to(peerId).emit("call_ended", {
            senderId: userId,
            reason: "disconnected",
          });
        }
      }

      io.emit("online-users", Array.from(onlineUsers.keys()));
      fastify.log.info(`User disconnected: ${userId}`);
    });
  });

  // Decorate Fastify instance
  fastify.decorate("io", io);
  fastify.decorate("onlineUsers", onlineUsers);
  fastify.decorate("activeCalls", activeCalls);
  fastify.decorate("isUserInConversationRoom", isUserInConversationRoom);
  fastify.decorate("getUsersInConversationRoom", getUsersInConversationRoom);
});

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
    onlineUsers: Map<string, Set<string>>; // Map<userId, Set<socketId>> - supports multiple sockets per user
    activeCalls: Map<string, CallData>;
    isUserInConversationRoom: (
      userId: string,
      conversationId: string
    ) => boolean;
    getUsersInConversationRoom: (conversationId: string) => string[];
  }
}
