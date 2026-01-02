import fp from "fastify-plugin";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { saveCallHistory, updateCallHistory } from "../utils/callHistory";
import { FileService } from "../utils/fileService";
import { createOnlineUsersStore } from "../utils/onlineUsers";
import { createConversationRoomsStore } from "../utils/conversationRooms";
import { createCallState, CallType, CallData } from "../utils/callState";
import { getJsonArray } from "../utils/jsonArray";
const prisma = new PrismaClient();

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

            if (updateResult.count > 0) {
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
            }
          } catch (error: any) {}
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

        setImmediate(async () => {
          try {
            const userIdInt = parseInt(userId);
            if (Number.isNaN(userIdInt)) {
              console.log("[LEAVE] Invalid userId:", userId);
              return;
            }

            // Check if there are any other users still in the conversation room
            const remainingUsers = getUsersInConversationRoom(conversationId);

            // Mark messages as unread when user leaves
            // If other users are still in room, they will mark as read again when they join
            const updateResult = await fastify.prisma.message.updateMany({
              where: {
                conversationId,
                NOT: { userId: userIdInt },
              },
              data: {
                isRead: false,
                isDelivered: false,
              },
            });

            // Verify the update worked by checking a sample message
            if (updateResult.count > 0) {
              const sampleMessage = await fastify.prisma.message.findFirst({
                where: {
                  conversationId,
                  NOT: { userId: userIdInt },
                },
                select: {
                  id: true,
                  isRead: true,
                  isDelivered: true,
                },
              });
            } else {
              console.log("[LEAVE] ⚠️ No messages were updated (count is 0)");
            }
          } catch (error: any) {
            console.error(
              "[LEAVE] ❌ Error marking messages as unread:",
              error
            );
            console.error("[LEAVE] ❌ Error message:", error?.message);
            console.error("[LEAVE] ❌ Error stack:", error?.stack);
          }
        });
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

        if (await activeCalls.has(receiverId)) {
          socket.emit("call_busy", { message: "User is busy" });
          return;
        }

        const callerIdNumber = Number(callerId);
        const receiverIdNumber = Number(receiverId);

        if (Number.isNaN(callerIdNumber) || Number.isNaN(receiverIdNumber)) {
          socket.emit("call_failed", { message: "Invalid user id" });
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

        const receiverFcmTokens = await getJsonArray<string>(
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
        // Clear any old ICE candidate buffers for this call
        clearIceCandidateBuffer(callerId, receiverId);
        // Emit to all sockets of the receiver (supports multiple tabs)
        const receiverSockets = getSocketsForUser(receiverId);
        if (receiverSockets && receiverSockets.size > 0) {
          io.to(receiverId).emit("call_incoming", {
            callerId,
            callType,
            callerInfo: {
              ...callerInfo,
              avatar: FileService.avatarUrl(callerInfo?.avatar || ""),
            },
            // offer,
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

        const callData = await activeCalls.get(callerIdLocal);
        if (!callData || callData.with !== calleeId) return;

        // Update status to in_call
        await activeCalls.set(callerIdLocal, {
          ...callData,
          status: "in_call",
        });
        await activeCalls.set(calleeId, {
          with: callerIdLocal,
          status: "in_call",
          type: callData.type,
        });

        // Update call history status to ONGOING
        const callId = await getCallHistoryForPair(callerIdLocal, calleeId);
        if (callId) {
          await updateCallHistory(
            fastify.prisma as PrismaClient | undefined,
            callId,
            "ONGOING"
          ).catch(() => {});
        }

        // Emit to all sockets of the caller
        const callerSockets = await getSocketsForUser(callerIdLocal);
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
        const senderId = await getUserId();
        if (!senderId || !receiverId) return;

        // When offer is sent, clear any old buffered ICE candidates
        // Clear both directions to ensure clean state
        const bufferKey1 = `${receiverId}-${senderId}`;
        const bufferKey2 = `${senderId}-${receiverId}`;
        await iceCandidateBuffers.delete(bufferKey1);
        await iceCandidateBuffers.delete(bufferKey2);

        // Emit to all sockets of the receiver
        const receiverSockets = await getSocketsForUser(receiverId);
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
        const senderCall = await activeCalls.get(senderId);
        const receiverCall = await activeCalls.get(receiverId);

        if (
          !senderCall ||
          !receiverCall ||
          senderCall.with !== receiverId ||
          receiverCall.with !== senderId
        ) {
          return;
        }

        const receiverSockets = await getSocketsForUser(receiverId);
        if (!receiverSockets || receiverSockets.size === 0) {
          return;
        }

        // CRITICAL FIX: Check if receiver has set remote description
        // If both have set remote descriptions, send immediately
        // Otherwise, buffer candidates (they'll be flushed when remote description is set)
        const isTURNRelay =
          (await candidate.candidate?.includes("typ relay")) ?? false;

        // If call is already in "in_call" status, it means SDP exchange is complete
        // So we can send the candidate immediately without buffering
        if (
          senderCall.status === "in_call" &&
          receiverCall.status === "in_call"
        ) {
          // Both sides have completed SDP exchange - send immediately
          io.to(receiverId).emit("webrtc_ice", { senderId, candidate });
        } else {
          // Buffer ICE candidate - will be flushed when receiver sets remote description
          // CRITICAL: Always buffer during "calling" phase to ensure proper timing
          const buffer = await getIceCandidateBuffer(receiverId, senderId);
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
        await activeCalls.delete(callerId);
        await activeCalls.delete(receiverId);

        // Clear ICE buffers
        await clearIceCandidateBuffer(callerId, receiverId);

        // Update call history status to DECLINED
        const callId = await getCallHistoryForPair(callerId, receiverId);
        if (callId) {
          await updateCallHistory(
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
        const callerSockets = await getSocketsForUser(callerId);
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
          const opponentSockets = getSocketsForUser(opponentId);
          if (opponentSockets && opponentSockets.size > 0) {
            // Emit to userId room, which will reach all sockets of that user
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

    socket.on(
      // এখানে তাই ঘটবে যেটা আমি call_end এ ঘটাতাম
      "answer_complete",
      ({
        receiverId,
        callerId,
        data,
      }: {
        receiverId: string;
        callerId: string;
        data: any;
      }) => {
        const senderId = getUserId();

        clearIceCandidateBuffer(callerId, receiverId);

        io.to(receiverId).emit("answer_complete", {
          senderId,
          data,
        });
      }
    );
    //--------------------------------------------------------------------
    // 13. Answer Complete — forward to the opposite user
    // এখাতে তাই ঘটবে যেটা আমি কল ইন্ড করলেই ঘটাই
    socket.on(
      "answer_complete",
      ({ receiverId, data }: { receiverId: string; data: any }) => {
        const senderId = getUserId();
        if (!senderId || !receiverId) return;

        const senderCall = activeCalls.get(senderId);
        const receiverCall = activeCalls.get(receiverId);
        console.log(receiverId, data);
        if (
          !senderCall ||
          !receiverCall ||
          senderCall.with !== receiverId ||
          receiverCall.with !== senderId
        ) {
          console.warn("[answer_complete] Users not in active call, ignoring");
          return;
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
    // 14. Call Offer Resend (caller resends offer if missed)

    //এখানে আমিশেটাই ঘটাবো যেটা আমি webrtc_offer এ ঘটাতাম
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
        const senderId = await getUserId();
        if (!senderId || !receiverId) return;

        const bufferKey1 = `${receiverId}-${senderId}`;
        const bufferKey2 = `${senderId}-${receiverId}`;
        await iceCandidateBuffers.delete(bufferKey1);
        await iceCandidateBuffers.delete(bufferKey2);

        // 🔁 RESEND OFFER
        io.to(receiverId).emit("call_offer_resend", {
          callerId: senderId,
          callType,
          callerInfo,
          sdp,
        });
      }
    );

    // 15. Request Offer (receiver asks for offer if missed)
    // এখানে আমিশেটাই ঘটাবো যেটা আমি call_answer_recent এ ঘটাতাম
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

        io.to(callerId).emit("call_answer_recent", {
          callerId,
          sdp,
        });
      }
    );

    //==========================================call end===========================================

    // 13. Disconnect - Cleanup
    socket.on("disconnect", () => {
      const userId = getUserId();
      if (!userId) {
        return;
      }

      // Remove this specific socket from user's socket set
      const remainingCount = removeSocket(userId, socket.id);

      // Only remove user from conversation rooms if this was their last socket
      if (remainingCount === 0) {
        // Remove user from all conversation rooms
        for (const [conversationId, room] of conversationRooms.entries()) {
          if (room.has(userId)) {
            leaveConversationRoom(userId, conversationId);
          }
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
    // @ts-ignore - TypeScript module augmentation quirk: identical types seen as different
    activeCalls: Map<string, CallData>;
    isUserInConversationRoom: (
      userId: string,
      conversationId: string
    ) => boolean;
    getUsersInConversationRoom: (conversationId: string) => string[];
  }
}
