import fp from "fastify-plugin";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import * as mediasoup from "mediasoup";
import * as os from "os";
import { saveCallHistory, updateCallHistory } from "../utils/callHistory";
import { FileService } from "../utils/fileService";
import { createOnlineUsersStore } from "../utils/onlineUsers";
import { createConversationRoomsStore } from "../utils/conversationRooms";
import { createCallState, CallType, CallData } from "../utils/callState";
import { getJsonArray } from "../utils/jsonArray";
const prisma = new PrismaClient();

// --- Mediasoup (group call / room) state ---
type MediasoupParticipant = {
  roomId: string;
  router: mediasoup.types.Router;
  transports: Map<string, mediasoup.types.WebRtcTransport>;
  producers: Map<string, mediasoup.types.Producer>;
  consumers: Map<string, mediasoup.types.Consumer>;
};
let mediasoupWorker: mediasoup.types.Worker | null = null;
const mediasoupRooms = new Map<string, mediasoup.types.Router>();
const mediasoupParticipants = new Map<string, MediasoupParticipant>();

function getLocalIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

async function createMediasoupWorker(): Promise<mediasoup.types.Worker> {
  if (mediasoupWorker) return mediasoupWorker;
  mediasoupWorker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });
  mediasoupWorker.on("died", () => {
    console.error("[mediasoup] Worker died");
    process.exit(1);
  });
  return mediasoupWorker;
}

async function getOrCreateMediasoupRouter(
  roomId: string
): Promise<mediasoup.types.Router> {
  const existing = mediasoupRooms.get(roomId);
  if (existing) return existing;
  const worker = await createMediasoupWorker();
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
    ],
  });
  mediasoupRooms.set(roomId, router);
  return router;
}

function getMediasoupProducersForRoom(
  roomId: string
): Array<{ id: string; kind: string; socketId: string }> {
  const list: Array<{ id: string; kind: string; socketId: string }> = [];
  for (const [socketId, p] of mediasoupParticipants) {
    if (p.roomId !== roomId) continue;
    for (const producer of p.producers.values()) {
      list.push({
        id: producer.id,
        kind: producer.kind,
        socketId,
      });
    }
  }
  return list;
}

function cleanupMediasoupParticipant(socketId: string): string | null {
  const p = mediasoupParticipants.get(socketId);
  if (!p) return null;
  p.transports.forEach((t) => t.close());
  mediasoupParticipants.delete(socketId);
  const leftInRoom = [...mediasoupParticipants.values()].filter(
    (x) => x.roomId === p.roomId
  );
  if (leftInRoom.length === 0) {
    const r = mediasoupRooms.get(p.roomId);
    if (r) {
      r.close();
      mediasoupRooms.delete(p.roomId);
    }
  }
  return p.roomId;
}

function isMediasoupRoomEmpty(roomId: string): boolean {
  return ![...mediasoupParticipants.values()].some((p) => p.roomId === roomId);
}

export default fp(async (fastify) => {
  await createMediasoupWorker();
  fastify.log.info("Mediasoup worker ready");

  const io = new Server(fastify.server, {
    cors: {
      origin: (_origin, callback) => callback(null, true),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  const {
    onlineUsers,
    addSocket,
    removeSocket,
    getUserIdBySocket,
    getSocketsForUser,
    getOnlineUserIds,
  } = createOnlineUsersStore();

  const {
    conversationRooms,
    joinConversationRoom,
    leaveConversationRoom,
    isUserInConversationRoom,
    getUsersInConversationRoom,
    getUserConversationRooms,
  } = createConversationRoomsStore();

  const {
    activeCalls,
    callHistoryMap,
    iceCandidateBuffers,
    getIceCandidateBuffer,
    clearIceCandidateBuffer,
    setCallHistoryForPair,
    getCallHistoryForPair,
    clearCallHistoryForPair,
  } = createCallState();

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

    // Helper: Get userId from socket (supports multiple sockets per user)
    const getUserId = () => getUserIdBySocket(socket.id);

    // 1. User Join
    socket.on("join", (userId: string) => {
      if (!userId) {
        return;
      }

      addSocket(userId, socket.id);
      socket.join(userId);

      io.emit("online-users", getOnlineUserIds());
    });

    // 2. Typing Indicators (based on conversation rooms)
    const handleTyping = (
      eventType: "start_typing" | "stop_typing",
      isTyping: boolean
    ) => {
      socket.on(
        eventType,
        ({
          conversationId,
          userId,
          userName,
        }: {
          conversationId: string;
          userId?: string;
          userName?: string;
        }) => {
          if (!conversationId) return;

          const actualUserId = (userId || getUserId())?.toString();
          if (
            !actualUserId ||
            !isUserInConversationRoom(actualUserId, conversationId)
          )
            return;

          const usersInRoom = getUsersInConversationRoom(conversationId);
          usersInRoom.forEach((memberUserId) => {
            if (memberUserId !== actualUserId) {
              io.to(memberUserId).emit(eventType, {
                conversationId,
                userId: actualUserId,
                userName,
                isTyping,
              });
            }
          });
        }
      );
    };

    handleTyping("start_typing", true);
    handleTyping("stop_typing", false);

    //-----------------------------------------------------------

    // 3. Get online users
    socket.on("get_online_users", () => {
      socket.emit("online-users", getOnlineUserIds());
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
          console.log(
            "join_conversation",
            "conversationId or userId is missing"
          );
          return;
        }
        console.log("join_conversation", "============Heat==============");
        console.log("conversationId", conversationId);
        console.log("userId", userId);
        const userIdStr = userId.toString();
        joinConversationRoom(userIdStr, conversationId);

        socket.emit("conversation_joined", {
          conversationId,
          userId: userIdStr,
        });

        setImmediate(async () => {
          try {
            const userIdInt = parseInt(userId);
            if (Number.isNaN(userIdInt)) return;

            // Mark all unread messages from other users as read when joining conversation room
            const [updateResult, members] = await Promise.all([
              fastify.prisma.message.updateMany({
                where: {
                  conversationId,
                  isRead: false,
                  NOT: { userId: userIdInt },
                },
                data: {
                  isRead: true,
                  isDelivered: true,
                },
              }),
              fastify.prisma.conversationMember.findMany({
                where: {
                  conversationId,
                  isDeleted: false,
                },
                select: { userId: true },
              }),
            ]);

            // Emit read status update to other members if messages were marked as read
            if (updateResult.count > 0) {
              const readStatusData = {
                success: true,
                conversationId,
                markedBy: userIdInt,
                markedAsRead: true,
                isDelivered: true,
              };

              members.forEach((member) => {
                if (member.userId && member.userId !== userIdInt) {
                  io.to(member.userId.toString()).emit(
                    "messages_marked_read",
                    readStatusData
                  );
                  io.to(member.userId.toString()).emit(
                    "message_delivered",
                    readStatusData
                  );
                }
              });
            }
          } catch (error: any) {
            console.error("[JOIN_CONVERSATION] Error marking messages as read:", error);
          }
        });
      }
    );

    // 5. Leave Conversation Room
    socket.on(
      "leave_conversation",
      async ({
        conversationId,
        userId,
      }: {
        conversationId: string;
        userId: string;
      }) => {
        if (!conversationId || !userId) {
          console.log(
            "conversation_left",
            "conversationId or userId is missing"
          );
          return;
        }
        const userIdStr = userId.toString();
        const removed = leaveConversationRoom(userIdStr, conversationId);
        socket.emit("conversation_left", { conversationId, userId: userIdStr });

        // NOTE: We do NOT mark messages as unread when leaving a conversation room.
        // Messages should remain read in the database. The read status is persistent
        // and should only change when explicitly marked via API or when joining a room.
        // Leaving a room is just a UI state change, not a read status change.
      }
    );

    //-----------------------------------------------------------
    // 'callerId': callerId,
    //       'receiverId': receiverId,
    //       'callType': isVideo ? 'video' : 'audio',
    //       "offer": offer.toMap(),
    // socketService.emit('call_initiate', {
    //       'callerId': callerId,
    //       'receiverId': receiverId,
    //       'callType': isVideo ? 'video' : 'audio',
    //       "offer": offer.toMap(),
    //     });
    //==========================================call===========================================
    // 6. Call Initiate (A calls B) offer send
    socket.on(
      "call_initiate",
      async ({
        // offer,
        callerId,
        receiverId,
        callType = "audio",
        callerName,
        callerAvatar,
      }: {
        // offer?: RTCSessionDescriptionInit;
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
          return;
        }

        let usersData: Array<{
          id: number;
          name: string | null;
          avatar: string | null;
          fcmToken: any;
        }>;
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
          socket.emit("call_failed", {
            message: "Failed to retrieve user info",
          });
          return;
        }

        // Extract caller and receiver info from results - O(1) lookup using Map
        const usersMap = new Map(usersData.map(u => [u.id, u]));
        const callerInfoFromDb = usersMap.get(callerIdNumber);
        const receiverData = usersMap.get(receiverIdNumber);

        const callerInfo = callerInfoFromDb || {
          id: callerIdNumber,
          name: callerName || `User ${callerId}`,
          avatar: callerAvatar || null,
        };

        const receiverFcmTokens = getJsonArray<string>(
          receiverData?.fcmToken,
          []
        );

        // Send push only to receiver (via FCM tokens)
        if (receiverFcmTokens.length > 0) {
          const pushData: Record<string, string> = {
            type: "call_initiate",
            success: "true",
            message: "Incoming call",
            data: JSON.stringify({
              callerId: String(callerId),
              callType: String(callType),
              callerInfo: {
                ...callerInfo,
                avatar: FileService.avatarUrl(callerInfo.avatar || ""),
              },
            }),
          };

          const pushPromises: Promise<any>[] = [];

          // Use receiverFcmTokens instead of member.user?.fcmToken
          if (receiverFcmTokens.length > 0) {
            const validTokens = receiverFcmTokens.filter(
              (token): token is string => Boolean(token)
            );

            // Add all push promises to array for parallel execution
            for (const token of validTokens) {
              pushPromises.push(
                fastify.sendDataPush(token, pushData).catch((error) => {
                  return { success: false, error };
                })
              );
            }

            if (pushPromises.length > 0) {
              await Promise.allSettled(pushPromises).catch(() => {});
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
          fastify.prisma as PrismaClient | undefined,
          {
            callerId: callerIdNumber,
            receiverId: receiverIdNumber,
            type: callTypeEnum,
            status: "ONGOING",
            startedAt: new Date(),
          }
        );
        if (callId) {
          setCallHistoryForPair(callerId, receiverId, callId);
        }
        //---------------------------------------------------
        clearIceCandidateBuffer(callerId, receiverId);
        const receiverSockets = getSocketsForUser(receiverId);
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
      }
    );

    // 7. Call Accept // i need to get the answer form frontend and send it to the caller
    socket.on(
      "call_accept",
      async ({
        callerId,
        receiverId,
      }: // answer,
      {
        callerId: string;
        receiverId: string;
        // answer: RTCSessionDescriptionInit;
      }) => {
        const callerIdLocal = callerId;
        const calleeId = receiverId;

        const callData = activeCalls.get(callerIdLocal);
        if (!callData || callData.with !== calleeId) return;

        // Update status to in_call
        activeCalls.set(callerIdLocal, {
          ...callData,
          status: "in_call",
        });
        activeCalls.set(calleeId, {
          with: callerIdLocal,
          status: "in_call",
          type: callData.type,
        });

        // Update call history status to ONGOING
        const callId = getCallHistoryForPair(callerIdLocal, calleeId);
        if (callId) {
          updateCallHistory(
            fastify.prisma as PrismaClient | undefined,
            callId,
            "ONGOING"
          ).catch(() => {});
        }

        // Emit to all sockets of the caller
        const callerSockets = getSocketsForUser(callerIdLocal);
        if (callerSockets && callerSockets.size > 0) {
          io.to(callerIdLocal).emit("call_accepted", {
            receiverId: calleeId,
            callType: callData.type,
            //answer,
          });
        }
      }
    );

    // 8. WebRTC Offer (SDP Offer)
    socket.on(
      "webrtc_offer",
      async ({
        receiverId,
        sdp,
      }: {
        receiverId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const senderId = getUserId();
        if (!senderId || !receiverId) return;

        // When offer is sent, clear any old buffered ICE candidates
        // Clear both directions to ensure clean state
        const bufferKey1 = `${receiverId}-${senderId}`;
        const bufferKey2 = `${senderId}-${receiverId}`;
        iceCandidateBuffers.delete(bufferKey1);
        iceCandidateBuffers.delete(bufferKey2);

        // Emit to all sockets of the receiver
        const receiverSockets = getSocketsForUser(receiverId);
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

        // When answer is sent, flush any buffered ICE candidates
        // Candidates from caller to receiver are buffered as `${receiverId}-${callerId}` = `${senderId}-${callerId}`
        // Candidates from receiver to caller are buffered as `${callerId}-${receiverId}` = `${callerId}-${senderId}`
        const bufferKeyFromCallerToReceiver = `${senderId}-${callerId}`; // Candidates from caller to receiver
        const bufferKeyFromReceiverToCaller = `${callerId}-${senderId}`; // Candidates from receiver to caller
        const bufferedCandidatesFromCaller = iceCandidateBuffers.get(
          bufferKeyFromCallerToReceiver
        );
        const bufferedCandidatesFromReceiver = iceCandidateBuffers.get(
          bufferKeyFromReceiverToCaller
        );

        // Emit answer to caller first
        const callerSockets = getSocketsForUser(callerId);
        if (callerSockets && callerSockets.size > 0) {
          io.to(callerId).emit("webrtc_answer", { senderId, sdp });

          // Send buffered ICE candidates FROM receiver TO caller (receiver sent these early)
          if (
            bufferedCandidatesFromReceiver &&
            bufferedCandidatesFromReceiver.length > 0
          ) {
            bufferedCandidatesFromReceiver.forEach((item) => {
              io.to(callerId).emit("webrtc_ice", {
                senderId,
                candidate: item.candidate,
              });
            });
            iceCandidateBuffers.delete(bufferKeyFromReceiverToCaller);
          }
        }

        // Send buffered ICE candidates FROM caller TO receiver (caller sent these before answer)
        const receiverSockets = getSocketsForUser(senderId);
        if (receiverSockets && receiverSockets.size > 0) {
          if (
            bufferedCandidatesFromCaller &&
            bufferedCandidatesFromCaller.length > 0
          ) {
            bufferedCandidatesFromCaller.forEach((item) => {
              io.to(senderId).emit("webrtc_ice", {
                senderId: callerId,
                candidate: item.candidate,
              });
            });
            iceCandidateBuffers.delete(bufferKeyFromCallerToReceiver);
          }
        }
      }
    );

    // 10. ICE Candidate (with buffering to prevent race conditions)
    socket.on(
      "webrtc_ice",
      async ({
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
          return;
        }

        const receiverSockets = getSocketsForUser(receiverId);
        if (!receiverSockets || receiverSockets.size === 0) {
          return;
        }

        const isTURNRelay =
          (candidate.candidate?.includes("typ relay")) ?? false;

        if (
          senderCall.status === "in_call" &&
          receiverCall.status === "in_call"
        ) {
          // Both sides have completed SDP exchange - send immediately
          io.to(receiverId).emit("webrtc_ice", { senderId, candidate });
        } else {
          // Buffer ICE candidate - will be flushed when receiver sets remote description
          // CRITICAL: Always buffer during "calling" phase to ensure proper timing
          const buffer = getIceCandidateBuffer(receiverId, senderId);
          buffer.push({
            candidate,
            timestamp: Date.now(),
          });

          // Log TURN relay candidates for debugging
          if (isTURNRelay) {
            console.log(
              `[ICE] Buffered TURN relay candidate from ${senderId} to ${receiverId}`
            );
          }
        }
      }
    );

    // 11. Call Decline
    socket.on(
      "call_decline",
      async ({
        callerId,
        receiverId,
      }: {
        callerId: string;
        receiverId: string;
      }) => {
        activeCalls.delete(callerId);
        activeCalls.delete(receiverId);

        // Clear ICE buffers
        clearIceCandidateBuffer(callerId, receiverId);

        // Update call history status to DECLINED
        const callId = getCallHistoryForPair(callerId, receiverId);
        if (callId) {
          updateCallHistory(
            fastify.prisma as PrismaClient | undefined,
            callId,
            "DECLINED",
            new Date()
          )
            .then(() => {
              clearCallHistoryForPair(callerId, receiverId);
            })
            .catch(() => {});
        }

        // Emit to all sockets of the caller
        const callerSockets = getSocketsForUser(callerId);
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

          clearIceCandidateBuffer(callerId, receiverId);

          const opponentId = endedByUserId === callerId ? receiverId : callerId;
          const opponentSockets = getSocketsForUser(opponentId);
          if (opponentSockets && opponentSockets.size > 0) {
            io.to(opponentId).emit("call_ended", {
              endedBy: endedByUserId,
              reason: "ended_by_user",
            });
          }

          // Update call history status - COMPLETED if accepted, CANCELED if not
          const callId = getCallHistoryForPair(callerId, receiverId);
          if (callId) {
            const finalStatus = wasAccepted ? "COMPLETED" : "CANCELED";
            updateCallHistory(
              fastify.prisma as PrismaClient | undefined,
              callId,
              finalStatus as "COMPLETED" | "CANCELED",
              new Date()
            )
              .then(() => {
                clearCallHistoryForPair(callerId, receiverId);
              })
              .catch(() => {});
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

              const opponentFcmTokens = getJsonArray<string>(
                opponentData?.fcmToken,
                []
              );
              if (opponentFcmTokens.length > 0) {
                const endedByUserInfo = endedByUserData
                  ? {
                      id: endedByUserData.id,
                      name: endedByUserData.name || `User ${endedByUserId}`,
                      avatar: FileService.avatarUrl(
                        endedByUserData.avatar || ""
                      ),
                    }
                  : null;

                const pushData: Record<string, string> = {
                  type: "call_ended",
                  success: "true",
                  message: wasAccepted ? "Call completed" : "Call canceled",
                  data: JSON.stringify({
                    callerId: String(callerId),
                    receiverId: String(receiverId),
                    callType: String(callType),
                    endedBy: String(endedByUserId),
                    reason: wasAccepted ? "completed" : "canceled",
                    ...(endedByUserInfo
                      ? { endedByUserInfo: endedByUserInfo }
                      : {}),
                  }),
                };

                const pushPromises: Promise<any>[] = [];
                const validTokens = opponentFcmTokens.filter(
                  (token): token is string => Boolean(token)
                );

                for (const token of validTokens) {
                  pushPromises.push(
                    fastify.sendDataPush(token, pushData).catch((error) => {
                      return { success: false, error };
                    })
                  );
                }

                if (pushPromises.length > 0) {
                  Promise.allSettled(pushPromises)
                    .then(() => {})
                    .catch(() => {});
                }
              }
            }
          } catch (error: any) {}
        } else {
        }
      }
    );

    // 13. Answer Complete — forward to the opposite user
    socket.on(
      "answer_complete",
      ({
        receiverId,
        callerId,
        data,
      }: {
        receiverId: string;
        callerId?: string;
        data: any;
      }) => {
        const senderId = getUserId();
        if (!senderId || !receiverId) return;

        // Validate active call if callerId is provided
        if (callerId) {
          const senderCall = activeCalls.get(senderId);
          const receiverCall = activeCalls.get(receiverId);
          
          if (
            !senderCall ||
            !receiverCall ||
            senderCall.with !== receiverId ||
            receiverCall.with !== senderId
          ) {
            console.warn("[answer_complete] Users not in active call, ignoring");
            return;
          }

          clearIceCandidateBuffer(callerId, receiverId);
        }

        const receiverSockets = getSocketsForUser(receiverId);
        if (receiverSockets && receiverSockets.size > 0) {
          console.log(
            `[answer_complete] Forwarding data from ${senderId} to ${receiverId}`,
            data
          );
          io.to(receiverId).emit("answer_complete", {
            senderId,
            data,
          });
        }
      }
    );

    // 14. Call Offer Resend (caller resends offer if missed)
    socket.on(
      "call_offer_resend",
      async ({
        receiverId,
        sdp,
        callType,
        callerInfo,
      }: {
        receiverId: string;
        sdp: RTCSessionDescriptionInit;
        callType: CallType;
        callerInfo: any;
      }) => {
        const senderId = getUserId();
        if (!senderId || !receiverId) return;

        const bufferKey1 = `${receiverId}-${senderId}`;
        const bufferKey2 = `${senderId}-${receiverId}`;
        iceCandidateBuffers.delete(bufferKey1);
        iceCandidateBuffers.delete(bufferKey2);

        io.to(receiverId).emit("call_offer_resend", {
          callerId: senderId,
          callType,
          callerInfo,
          sdp,
        });
      }
    );

    // 15. Request Offer (receiver asks for offer if missed)
    socket.on(
      "call_answer_recent",
      async ({
        callerId,
        sdp,
      }: {
        callerId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const senderId = getUserId();
        if (!senderId || !callerId) return;

        const bufferKeyFromCallerToReceiver = `${senderId}-${callerId}`; // Candidates from caller to receiver
        const bufferKeyFromReceiverToCaller = `${callerId}-${senderId}`; // Candidates from receiver to caller
        const bufferedCandidatesFromCaller = iceCandidateBuffers.get(
          bufferKeyFromCallerToReceiver
        );
        const bufferedCandidatesFromReceiver = iceCandidateBuffers.get(
          bufferKeyFromReceiverToCaller
        );

        // Emit answer to caller first
        const callerSockets = getSocketsForUser(callerId);

        if (callerSockets && callerSockets.size > 0) {
          // Emit webrtc_answer (same as webrtc_answer handler does)
          io.to(callerId).emit("webrtc_answer", { senderId, sdp });

          // Also emit call_answer_recent for frontend to know this is a recent answer
          io.to(callerId).emit("call_answer_recent", {
            senderId,
            sdp,
          });

          if (
            bufferedCandidatesFromReceiver &&
            bufferedCandidatesFromReceiver.length > 0
          ) {
            bufferedCandidatesFromReceiver.forEach((item) => {
              io.to(callerId).emit("webrtc_ice", {
                senderId,
                candidate: item.candidate,
              });
            });
            iceCandidateBuffers.delete(bufferKeyFromReceiverToCaller);
          }

          const receiverSockets = getSocketsForUser(senderId);
          if (receiverSockets && receiverSockets.size > 0) {
            if (
              bufferedCandidatesFromCaller &&
              bufferedCandidatesFromCaller.length > 0
            ) {
              bufferedCandidatesFromCaller.forEach((item) => {
                io.to(senderId).emit("webrtc_ice", {
                  senderId: callerId,
                  candidate: item.candidate,
                });
              });
              iceCandidateBuffers.delete(bufferKeyFromCallerToReceiver);
            }
          }
        }
      }
    );

    //==========================================call end===========================================


    //==========================================mediasoup Group Call (room / SFU)===========================================
    socket.on(
      "createRoom",
      async (
        { roomId }: { roomId: string },
        cb: (arg: { rtpCapabilities?: mediasoup.types.RtpCapabilities; error?: string }) => void
      ) => {
        console.log("[createRoom] received", { roomId, socketId: socket.id });
        try {
          if (!roomId) {
            console.log("[createRoom] rejected: roomId required");
            cb({ error: "roomId required" });
            return;
          }
          const userId = getUserIdBySocket(socket.id);
          if (!userId) {
            console.log("[createRoom] rejected: user not joined (emit join with userId first)");
            cb({ error: "Join first with your user ID" });
            return;
          }
          console.log("[createRoom] checking membership for userId", userId);
          const isMember = await fastify.prisma.conversationMember.findFirst({
            where: {
              conversationId: roomId,
              userId: Number(userId),
              isDeleted: false,
            },
          });
          if (!isMember) {
            console.log("[createRoom] rejected: user not in group", userId);
            cb({ error: "You are not in this group" });
            return;
          }
          const wasEmpty = isMediasoupRoomEmpty(roomId);
          console.log("[createRoom] room was empty:", wasEmpty, "→ creating/joining router");
          const router = await getOrCreateMediasoupRouter(roomId);
          mediasoupParticipants.set(socket.id, {
            roomId,
            router,
            transports: new Map(),
            producers: new Map(),
            consumers: new Map(),
          });
          socket.join(roomId);
          if (wasEmpty) {
            console.log("[createRoom] first in room → emitting group_call_started to all members");
            const members = await fastify.prisma.conversationMember.findMany({
              where: { conversationId: roomId, isDeleted: false, userId: { not: null } },
              select: { userId: true },
            });
            for (const m of members) {
              if (m.userId) io.to(String(m.userId)).emit("group_call_started", { conversationId: roomId });
            }
          }
          console.log("[createRoom] success for socket", socket.id, "roomId", roomId);
          cb({ rtpCapabilities: router.rtpCapabilities });
        } catch (err: any) {
          console.error("[createRoom] failed", err);
          cb({ error: err?.message || "createRoom failed" });
        }
      }
    );

    socket.on(
      "createTransport",
      async (
        _payload: { type: string },
        cb: (arg: {
          id?: string;
          iceParameters?: any;
          iceCandidates?: any[];
          dtlsParameters?: any;
          error?: string;
        }) => void
      ) => {
        const type = _payload?.type ?? "?";
        console.log("[createTransport] received", { type, socketId: socket.id });
        try {
          const p = mediasoupParticipants.get(socket.id);
          if (!p) {
            console.log("[createTransport] rejected: participant not found");
            cb({ error: "Participant not found" });
            return;
          }
          const announcedIp =
            process.env.MEDIASOUP_ANNOUNCED_IP || getLocalIp();
          const transport = await p.router.createWebRtcTransport({
            listenIps: [{ ip: "0.0.0.0", announcedIp }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            appData: { type: type === "recv" ? "recv" : "send" },
          });
          p.transports.set(transport.id, transport);
          transport.on("dtlsstatechange", (state) => {
            if (state === "closed") transport.close();
          });
          console.log("[createTransport] created", type, "transport", transport.id, "for socket", socket.id);
          cb({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
        } catch (err: any) {
          console.error("[createTransport] failed", err);
          cb({ error: err?.message || "createTransport failed" });
        }
      }
    );

    socket.on(
      "connectTransport",
      async (
        {
          transportId,
          dtlsParameters,
        }: { transportId: string; dtlsParameters: any },
        cb: (arg: { success?: boolean; error?: string }) => void
      ) => {
        console.log("[connectTransport] received", { transportId, socketId: socket.id });
        try {
          const p = mediasoupParticipants.get(socket.id);
          const t = p?.transports.get(transportId);
          if (!t) {
            console.log("[connectTransport] rejected: transport or participant not found");
            cb({ error: p ? "Transport not found" : "Participant not found" });
            return;
          }
          const transportType = (t.appData as { type?: string })?.type ?? "send";
          if (transportType === "recv") {
            // Recv transports: do not call connect(); they are ready after creation.
            // Client still sends connectTransport; we ack success so the client can proceed.
            console.log("[connectTransport] RECV transport", transportId, "— ack without connect()");
            cb({ success: true });
          } else {
            await t.connect({ dtlsParameters });
            console.log("[connectTransport] SEND transport", transportId, "connected");
            cb({ success: true });
          }
        } catch (err: any) {
          console.error("[connectTransport] failed", err);
          cb({ error: err?.message || "connectTransport failed" });
        }
      }
    );

    socket.on(
      "produce",
      async (
        {
          transportId,
          kind,
          rtpParameters,
        }: { transportId: string; kind: string; rtpParameters: any },
        cb: (arg: { id?: string; error?: string }) => void
      ) => {
        console.log("[produce] received", { transportId, kind, socketId: socket.id });
        try {
          const p = mediasoupParticipants.get(socket.id);
          const t = p?.transports.get(transportId);
          if (!t) {
            console.log("[produce] rejected: transport or participant not found");
            cb({ error: p ? "Transport not found" : "Participant not found" });
            return;
          }
          const producer = await t.produce({
            kind: kind as mediasoup.types.MediaKind,
            rtpParameters,
          });
          p!.producers.set(producer.id, producer);
          console.log("[produce] created producer", producer.id, kind, "→ emitting newProducer to room", p!.roomId);
          socket.to(p!.roomId).emit("newProducer", {
            producerId: producer.id,
            kind: producer.kind,
            socketId: socket.id,
          });
          cb({ id: producer.id });
        } catch (err: any) {
          console.error("[produce] failed", err);
          cb({ error: err?.message || "produce failed" });
        }
      }
    );

    socket.on(
      "consume",
      async (
        {
          transportId,
          producerId,
          rtpCapabilities,
        }: { transportId: string; producerId: string; rtpCapabilities: any },
        cb: (arg: {
          id?: string;
          producerId?: string;
          kind?: string;
          rtpParameters?: any;
          error?: string;
        }) => void
      ) => {
        console.log("[consume] received", { transportId, producerId, socketId: socket.id });
        try {
          const p = mediasoupParticipants.get(socket.id);
          if (!p) {
            console.log("[consume] rejected: participant not found");
            cb({ error: "Participant not found" });
            return;
          }
          let producer: mediasoup.types.Producer | undefined;
          let producerSocketId: string | undefined;
          for (const [sid, px] of mediasoupParticipants) {
            if (px.producers.has(producerId)) {
              producer = px.producers.get(producerId);
              producerSocketId = sid;
              break;
            }
          }
          if (!producer || !producerSocketId) {
            console.log("[consume] rejected: producer not found", producerId);
            cb({ error: "Producer not found" });
            return;
          }
          if (producerSocketId === socket.id) {
            console.log("[consume] rejected: cannot consume own producer");
            cb({ error: "Cannot consume own producer" });
            return;
          }
          if (
            !p.router.canConsume({
              producerId,
              rtpCapabilities,
            })
          ) {
            console.log("[consume] rejected: RTP capabilities mismatch");
            cb({ error: "RTP capabilities mismatch" });
            return;
          }
          const recvTransport = p.transports.get(transportId);
          if (!recvTransport) {
            console.log("[consume] rejected: receive transport not found");
            cb({ error: "Receive transport not found" });
            return;
          }
          const consumer = await recvTransport.consume({
            producerId,
            rtpCapabilities,
            paused: false,
          });
          p.consumers.set(consumer.id, consumer);
          console.log("[consume] created consumer", consumer.id, "for producer", producerId, "socket", socket.id);
          cb({
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });
        } catch (err: any) {
          console.error("[consume] failed", err);
          cb({ error: err?.message || "consume failed" });
        }
      }
    );

    socket.on(
      "getProducers",
      (
        _dataOrCb: any,
        maybeCb?: (arg: { producers?: Array<{ id: string; kind: string; socketId: string }>; error?: string }) => void
      ) => {
        const cb =
          typeof _dataOrCb === "function" ? _dataOrCb : maybeCb;
        console.log("[getProducers] received", { socketId: socket.id });
        const p = mediasoupParticipants.get(socket.id);
        if (!p) {
          console.log("[getProducers] rejected: participant not found");
          cb?.({ error: "Participant not found" });
          return;
        }
        const producers = getMediasoupProducersForRoom(p.roomId);
        console.log("[getProducers] room", p.roomId, "producers count:", producers.length, producers);
        cb?.({ producers });
      }
    );

    socket.on(
      "resumeConsumer",
      async (
        { consumerId }: { consumerId: string },
        cb: (arg: { success?: boolean; error?: string }) => void
      ) => {
        console.log("[resumeConsumer] received", { consumerId, socketId: socket.id });
        try {
          const p = mediasoupParticipants.get(socket.id);
          const c = p?.consumers.get(consumerId);
          if (!c) {
            console.log("[resumeConsumer] rejected: consumer or participant not found");
            cb({ error: p ? "Consumer not found" : "Participant not found" });
            return;
          }
          if (c.paused) await c.resume();
          console.log("[resumeConsumer] resumed consumer", consumerId);
          cb({ success: true });
        } catch (err: any) {
          console.error("[resumeConsumer] failed", err);
          cb({ error: err?.message || "resumeConsumer failed" });
        }
      }
    );

    socket.on("leaveRoom", async () => {
      console.log("[leaveRoom] received", { socketId: socket.id });
      const roomId = cleanupMediasoupParticipant(socket.id);
      if (roomId) {
        socket.leave(roomId);
        console.log("[leaveRoom] socket left room", roomId, "→ emitting participantLeft");
        socket.to(roomId).emit("participantLeft", { socketId: socket.id });
        if (isMediasoupRoomEmpty(roomId)) {
          console.log("[leaveRoom] room now empty → emitting group_call_ended to all members");
          try {
            const members = await fastify.prisma.conversationMember.findMany({
              where: { conversationId: roomId, isDeleted: false, userId: { not: null } },
              select: { userId: true },
            });
            for (const m of members) {
              if (m.userId) io.to(String(m.userId)).emit("group_call_ended", { conversationId: roomId });
            }
          } catch (_) {}
        }
      } else {
        console.log("[leaveRoom] socket was not in any room");
      }
    });

    // Group call: verify caller is in group, then notify members (no DB save)
    socket.on(
      "group_call_initiate",
      async ({
        callerId,
        conversationId,
        callType = "video",
        callerName,
        callerAvatar,
      }: {
        callerId: string;
        conversationId: string;
        callType?: CallType;
        callerName?: string;
        callerAvatar?: string;
      }) => {
        console.log("[group_call_initiate] received", {
          callerId,
          conversationId,
          callType,
          callerName,
          socketId: socket.id,
        });

        if (!callerId || !conversationId) {
          console.log("[group_call_initiate] skipped: missing callerId or conversationId");
          return;
        }

        try {
          const members = await fastify.prisma.conversationMember.findMany({
            where: {
              conversationId,
              isDeleted: false,
              userId: { not: null },
            },
            select: { userId: true },
          });

          const memberIds = members.map((m) => m.userId).filter((id): id is number => id != null);
          console.log("[group_call_initiate] conversation members (userId)", memberIds);

          const callerIsMember = members.some((m) => m.userId !== null && String(m.userId) === callerId);
          if (!callerIsMember) {
            console.log("[group_call_initiate] caller not in group → sending group_call_error to caller", callerId);
            const callerSockets = getSocketsForUser(callerId);
            if (callerSockets?.size) {
              io.to(callerId).emit("group_call_error", { message: "You are not in this group" });
            }
            return;
          }

          const memberUserIds = memberIds.filter((id) => String(id) !== callerId);
          console.log("[group_call_initiate] ringing these members (excluding caller)", memberUserIds);

          const callerInfo = {
            id: Number(callerId),
            name: callerName ?? `User ${callerId}`,
            avatar: callerAvatar ? FileService.avatarUrl(callerAvatar) : null,
          };

          for (const userId of memberUserIds) {
            const userIdStr = String(userId);
            const sockets = getSocketsForUser(userIdStr);
            if (sockets && sockets.size > 0) {
              console.log("[group_call_initiate] emitting group_call_incoming to user", userIdStr);
              io.to(userIdStr).emit("group_call_incoming", {
                callerId,
                conversationId,
                callType,
                callerInfo,
              });
            } else {
              console.log("[group_call_initiate] user", userIdStr, "has no connected sockets (offline)");
            }
          }

          console.log("[group_call_initiate] emitting group_call_started to all members");
          for (const m of members) {
            if (m.userId) io.to(String(m.userId)).emit("group_call_started", { conversationId });
          }
          console.log("[group_call_initiate] done");
        } catch (err: any) {
          console.error("[group_call_initiate] failed", err);
          fastify.log.warn(err, "group_call_initiate failed");
        }
      }
    );

    //==========================================mediasoup Group Call end===========================================

    // 13. Disconnect - Cleanup
    socket.on("disconnect", () => {
      const mediasoupRoomId = cleanupMediasoupParticipant(socket.id);
      if (mediasoupRoomId) {
        socket.to(mediasoupRoomId).emit("participantLeft", {
          socketId: socket.id,
        });
        if (isMediasoupRoomEmpty(mediasoupRoomId)) {
          void fastify.prisma.conversationMember
            .findMany({
              where: { conversationId: mediasoupRoomId, isDeleted: false, userId: { not: null } },
              select: { userId: true },
            })
            .then((members) => {
              for (const m of members) {
                if (m.userId) io.to(String(m.userId)).emit("group_call_ended", { conversationId: mediasoupRoomId });
              }
            })
            .catch(() => {});
        }
      }

      const userId = getUserId();
      if (!userId) {
        return;
      }

      const remainingCount = removeSocket(userId, socket.id);

      if (remainingCount === 0) {
        const userConversationIds = getUserConversationRooms(userId);
        userConversationIds.forEach(conversationId => {
          leaveConversationRoom(userId, conversationId);
        });
      }

      if (activeCalls.has(userId)) {
        const call = activeCalls.get(userId)!;
        const peerId = call.with;
        activeCalls.delete(userId);
        activeCalls.delete(peerId);

        // Clear ICE buffers
        clearIceCandidateBuffer(userId, peerId);

        // Update call history status to MISSED
        const callId = getCallHistoryForPair(userId, peerId);
        if (callId) {
          updateCallHistory(
            fastify.prisma as PrismaClient | undefined,
            callId,
            "MISSED",
            new Date()
          )
            .then(() => {
              clearCallHistoryForPair(userId, peerId);
            })
            .catch(() => {});
        }

        // Emit to all sockets of the peer
        const peerSockets = getSocketsForUser(peerId);
        if (peerSockets && peerSockets.size > 0) {
          io.to(peerId).emit("call_ended", {
            senderId: userId,
            reason: "disconnected",
          });
        }
      }

      io.emit("online-users", getOnlineUserIds());
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
    onlineUsers: Map<string, Set<string>>;
    activeCalls: Map<string, CallData>;
    isUserInConversationRoom: (
      userId: string,
      conversationId: string
    ) => boolean;
    getUsersInConversationRoom: (conversationId: string) => string[];
  }
}
