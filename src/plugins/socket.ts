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
  const onlineUsers = new Map<string, string>();
  const activeCalls = new Map<string, CallData>();
  //---------------------------------------------------
  const callHistoryMap = new Map<string, string>();
  
  // Conversation room tracking: Map<conversationId, Set<userId>>
  const conversationRooms = new Map<string, Set<string>>();
  
  // Helper: Check if user is in conversation room
  const isUserInConversationRoom = (userId: string, conversationId: string): boolean => {
    const room = conversationRooms.get(conversationId);
    return room ? room.has(userId) : false;
  };
  
  // Helper: Join conversation room
  const joinConversationRoom = (userId: string, conversationId: string) => {
    if (!conversationRooms.has(conversationId)) {
      conversationRooms.set(conversationId, new Set());
    }
    conversationRooms.get(conversationId)!.add(userId);
    fastify.log.info(`User ${userId} joined conversation room ${conversationId}`);
  };
  
  // Helper: Leave conversation room
  const leaveConversationRoom = (userId: string, conversationId: string) => {
    const room = conversationRooms.get(conversationId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        conversationRooms.delete(conversationId);
      }
      fastify.log.info(`User ${userId} left conversation room ${conversationId}`);
    }
  };
  
  // Helper: Get all users in a conversation room
  const getUsersInConversationRoom = (conversationId: string): string[] => {
    const room = conversationRooms.get(conversationId);
    return room ? Array.from(room) : [];
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

    // Helper: Get userId from socket (we'll set it on join)
    const getUserId = () => {
      for (const [userId, sid] of onlineUsers.entries()) {
        if (sid === socket.id) return userId;
      }
      return null;
    };

    // 1. User Join
    socket.on("join", (userId: string) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      socket.join(userId);
      fastify.log.info(`User joined: ${userId}`);

      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // 2. Typing Indicators
    socket.on(
      "typing",
      ({ targetUserId, conversationId, userName, userId }) => {
        socket.to(targetUserId).emit("user_typing", {
          conversationId,
          userId,
          userName,
          isTyping: true,
        });
      }
    );

    socket.on(
      "stop_typing",
      ({ targetUserId, conversationId, userName, userId }) => {
        socket.to(targetUserId).emit("user_stop_typing", {
          conversationId,
          userId,
          userName,
          isTyping: false,
        });
      }
    );

    // 3. Get online users
    socket.on("get_online_users", () => {
      socket.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // 4. Join Conversation Room
    socket.on("join_conversation", ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      if (!conversationId || !userId) return;

      joinConversationRoom(userId, conversationId);
      socket.join(`conversation:${conversationId}`);
      socket.emit("conversation_joined", { conversationId });
      fastify.log.info(`Socket ${socket.id}: User ${userId} joined conversation ${conversationId}`);
    });

    // 5. Leave Conversation Room
    socket.on("leave_conversation", ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      if (!conversationId || !userId) return;

      leaveConversationRoom(userId, conversationId);
      socket.leave(`conversation:${conversationId}`);
      socket.emit("conversation_left", { conversationId });
      fastify.log.info(`Socket ${socket.id}: User ${userId} left conversation ${conversationId}`);
    });

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
          if (Array.isArray(receiverFcmTokens) && receiverFcmTokens.length > 0) {
            const validTokens = receiverFcmTokens.filter((token): token is string =>
              Boolean(token)
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

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("call_incoming", {
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

         //---------------------------------------------------
        // Update call history status to ONGOING
        const callKey = `${callerIdLocal}-${calleeId}`;
        const callId = callHistoryMap.get(callKey);
        if (callId) {
          updateCallHistory(callId, "ONGOING").catch((error) => {
            fastify.log.error(`Failed to update call history on accept: ${error.message}`);
          });
        }
         //---------------------------------------------------

        const callerSocketId = onlineUsers.get(callerIdLocal);
        if (callerSocketId) {
          io.to(callerSocketId).emit("call_accepted", {
            receiverId: calleeId,
            callType: callData.type,
          });
        }

        fastify.log.info(`Call accepted: ${callerIdLocal} ↔ ${calleeId}`);
      }
    );

    // 8. WebRTC Offer (SDP Offer)
    //---------------------------------------------------
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

        const targetSocketId = onlineUsers.get(receiverId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("webrtc_offer", { senderId, sdp });
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

        const targetSocketId = onlineUsers.get(callerId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("webrtc_answer", { callerId, sdp });
        }
      }
    );

    // 10. ICE Candidate
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

        const targetSocketId = onlineUsers.get(receiverId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("webrtc_ice", { senderId, candidate });
        }
      }
    );

    // 11. Call Decline
    socket.on(
      "call_decline",
      ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
        activeCalls.delete(callerId);
        activeCalls.delete(receiverId);

         //---------------------------------------------------
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
              fastify.log.error(`Failed to update call history on decline: ${error.message}`);
            });
        }
         //---------------------------------------------------

        const callerSocketId = onlineUsers.get(callerId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("call_declined", { receiverId });
        }
      }
    );

    // 10. Call End
    // socket.on(
    //   "call_end",
    //   ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
    //     activeCalls.delete(callerId);
    //     activeCalls.delete(receiverId);

    //     const peerSocketId = onlineUsers.get(receiverId);
    //     if (peerSocketId) {
    //       io.to(peerSocketId).emit("call_ended", { callerId });
    //     }
    //   }
    // );

    // 12. Call End - Fixed version
    socket.on(
      "call_end",
      async ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
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

          const opponentId = endedByUserId === callerId ? receiverId : callerId;
          const opponentSocketId = onlineUsers.get(opponentId);

          if (opponentSocketId && opponentSocketId !== socket.id) {
            io.to(opponentSocketId).emit("call_ended", {
              endedBy: endedByUserId,
              reason: "ended_by_user",
            });
          }

          // Update call history status - COMPLETED if accepted, CANCELED if not
          const callKey = `${callerId}-${receiverId}`;
          const callId = callHistoryMap.get(callKey);
          if (callId) {
            const finalStatus = wasAccepted ? "COMPLETED" : "CANCELED";
            updateCallHistory(callId, finalStatus as "COMPLETED" | "CANCELED", new Date())
              .then(() => {
                callHistoryMap.delete(callKey);
                callHistoryMap.delete(`${receiverId}-${callerId}`);
              })
              .catch((error) => {
                fastify.log.error(`Failed to update call history on end: ${error.message}`);
              });
          }

          // Send push notification to opponent
          try {
            const callerIdNumber = Number(callerId);
            const receiverIdNumber = Number(receiverId);
            const opponentIdNumber = Number(opponentId);

            if (!Number.isNaN(callerIdNumber) && !Number.isNaN(receiverIdNumber)) {
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

              const opponentData = usersData.find((u) => u.id === opponentIdNumber);
              const endedByUserData = usersData.find((u) => u.id === Number(endedByUserId));

              if (opponentData && opponentData.fcmToken && opponentData.fcmToken.length > 0) {
                const endedByUserInfo = endedByUserData
                  ? {
                      id: endedByUserData.id.toString(),
                      name: endedByUserData.name || `User ${endedByUserId}`,
                      avatar: FileService.avatarUrl(endedByUserData.avatar || ""),
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
                const validTokens = opponentData.fcmToken.filter((token): token is string =>
                  Boolean(token)
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

    //-----------------for group call--------------
    // 10. Call End - More secure version
    // socket.on(
    //   "call_end",
    //   (data: { callerId?: string; receiverId?: string }) => {
    //     const endedByUserId = getUserId();
    //     if (!endedByUserId) return;

    //     // বর্তমান ইউজারের অ্যাক্টিভ কল খুঁজুন
    //     const userCall = activeCalls.get(endedByUserId);
    //     if (!userCall) {
    //       fastify.log.warn(`No active call found for user ${endedByUserId}`);
    //       return;
    //     }

    //     const opponentId = userCall.with;

    //     // opponent এর কল ডাটাও চেক করুন
    //     const opponentCall = activeCalls.get(opponentId);
    //     if (!opponentCall || opponentCall.with !== endedByUserId) {
    //       fastify.log.error(`Call data inconsistency for ${endedByUserId} and ${opponentId}`);
    //       // ডাটা inconsistent, তাই ক্লিনআপ করুন
    //       activeCalls.delete(endedByUserId);
    //       activeCalls.delete(opponentId);
    //       return;
    //     }

    //     // কল ডিলিট করুন
    //     activeCalls.delete(endedByUserId);
    //     activeCalls.delete(opponentId);

    //     // প্রতিপক্ষকে নোটিফাই করুন
    //     const opponentSocketId = onlineUsers.get(opponentId);
    //     if (opponentSocketId) {
    //       io.to(opponentSocketId).emit("call_ended", {
    //         endedBy: endedByUserId,
    //         reason: "ended_by_user"
    //       });
    //     }

    //     fastify.log.info(`Call ended by ${endedByUserId}: ${endedByUserId} ❌ ${opponentId}`);
    //   }
    // );
    //---------------------------------------------------

    // 13. Disconnect - Cleanup
    socket.on("disconnect", () => {
      const userId = getUserId();
      if (!userId) return;

      // Remove user from all conversation rooms
      for (const [conversationId, room] of conversationRooms.entries()) {
        if (room.has(userId)) {
          leaveConversationRoom(userId, conversationId);
        }
      }

      onlineUsers.delete(userId);

      if (activeCalls.has(userId)) {
        const call = activeCalls.get(userId)!;
        const peerId = call.with;
        activeCalls.delete(userId);
        activeCalls.delete(peerId);

         //---------------------------------------------------

        // Update call history status to MISSED
        const callKey = `${userId}-${peerId}`;
        const callId = callHistoryMap.get(callKey) || callHistoryMap.get(`${peerId}-${userId}`);
        if (callId) {
          updateCallHistory(callId, "MISSED", new Date())
            .then(() => {
              callHistoryMap.delete(callKey);
              callHistoryMap.delete(`${peerId}-${userId}`);
            })
            .catch((error) => {
              fastify.log.error(`Failed to update call history on disconnect: ${error.message}`);
            });
        }
         //---------------------------------------------------

        const peerSocketId = onlineUsers.get(peerId);
        if (peerSocketId) {
          io.to(peerSocketId).emit("call_ended", {
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
    onlineUsers: Map<string, string>;
    activeCalls: Map<string, CallData>;
    isUserInConversationRoom: (userId: string, conversationId: string) => boolean;
    getUsersInConversationRoom: (conversationId: string) => string[];
  }
}