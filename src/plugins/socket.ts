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
    debugGetAllRooms,
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

    // Debug: Get conversation room state
    socket.on("debug_get_room_state", ({ conversationId }: { conversationId: string }) => {
      const users = getUsersInConversationRoom(conversationId);
      const allRooms = debugGetAllRooms();
      socket.emit("debug_room_state", {
        conversationId,
        usersInRoom: users,
        allRooms,
      });
      process.stdout.write(`[DEBUG] Room state requested for ${conversationId}: [${users.join(", ")}]\n`);
      process.stdout.write(`[DEBUG] All rooms: ${JSON.stringify(allRooms)}\n`);
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
          console.log("join_conversation", "conversationId or userId is missing");
          return;
        }
        console.log("join_conversation", "============Heat==============");
        console.log("conversationId", conversationId);
        console.log("userId", userId);
        const userIdStr = userId.toString();
        
        // Get room state BEFORE joining
        const roomStateBeforeJoin = getUsersInConversationRoom(conversationId);
        process.stdout.write(`[SOCKET JOIN] BEFORE: Room users: [${roomStateBeforeJoin.join(", ")}]\n`);
        
        // Verify function exists before calling
        if (typeof joinConversationRoom !== 'function') {
          console.error(`❌ [SOCKET JOIN] ERROR: joinConversationRoom is not a function! Type: ${typeof joinConversationRoom}`);
          process.stderr.write(`❌ [SOCKET JOIN] ERROR: joinConversationRoom is not a function!\n`);
        } else {
          console.error(`✅ [SOCKET JOIN] joinConversationRoom is a function, calling now...`);
          process.stdout.write(`[SOCKET JOIN] Calling joinConversationRoom for user ${userIdStr}...\n`);
          process.stderr.write(`[SOCKET JOIN] Calling joinConversationRoom for user ${userIdStr}...\n`);
          
          try {
        joinConversationRoom(userIdStr, conversationId);
            console.error(`✅ [SOCKET JOIN] joinConversationRoom call completed`);
          } catch (error: any) {
            console.error(`❌ [SOCKET JOIN] ERROR calling joinConversationRoom:`, error);
            process.stderr.write(`❌ [SOCKET JOIN] ERROR: ${error?.message || error}\n`);
          }
        }
        
        // Get room state AFTER joining
        const roomStateAfterJoin = getUsersInConversationRoom(conversationId);
        process.stdout.write(`[SOCKET JOIN] AFTER: Room users: [${roomStateAfterJoin.join(", ")}]\n`);
        process.stderr.write(`[SOCKET JOIN] AFTER: Room users: [${roomStateAfterJoin.join(", ")}]\n`);
        console.error(`[SOCKET JOIN] AFTER: Room users: [${roomStateAfterJoin.join(", ")}], User ${userIdStr} in room: ${roomStateAfterJoin.includes(userIdStr)}`);
        process.stdout.write(`[SOCKET JOIN] User ${userIdStr} should now be in room: ${roomStateAfterJoin.includes(userIdStr)}\n\n`);

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
        if (!conversationId || !userId){
          console.log("conversation_left", "conversationId or userId is missing");
          return;
        } 
        console.log("conversation_left", "============Heat==============");
        console.log("conversationId", conversationId);
        console.log("userId", userId);

        // Convert userId to string for consistency (same as join_conversation)
        const userIdStr = userId.toString();
        
        // Check if user is in room before leaving (for debugging)
        const wasInRoomBefore = isUserInConversationRoom(userIdStr, conversationId);
        console.log(`[Leave Room] User ${userIdStr} was in room ${conversationId} before leave: ${wasInRoomBefore}`);
        
        // Get room state BEFORE leaving
        const roomStateBefore = getUsersInConversationRoom(conversationId);
        process.stdout.write(`[SOCKET LEAVE] BEFORE: Room users: [${roomStateBefore.join(", ")}]\n`);
        
        // Remove user from conversation room
        let wasRemoved = false;
        // Verify function exists before calling
        if (typeof leaveConversationRoom !== 'function') {
          console.error(`❌ [SOCKET LEAVE] ERROR: leaveConversationRoom is not a function! Type: ${typeof leaveConversationRoom}`);
          process.stderr.write(`❌ [SOCKET LEAVE] ERROR: leaveConversationRoom is not a function!\n`);
        } else {
          console.error(`✅ [SOCKET LEAVE] leaveConversationRoom is a function, calling now...`);
          process.stdout.write(`[SOCKET LEAVE] Calling leaveConversationRoom for user ${userIdStr}...\n`);
          process.stderr.write(`[SOCKET LEAVE] Calling leaveConversationRoom for user ${userIdStr}...\n`);
          
          try {
            wasRemoved = leaveConversationRoom(userIdStr, conversationId);
            console.error(`✅ [SOCKET LEAVE] leaveConversationRoom call completed, returned: ${wasRemoved}`);
          } catch (error: any) {
            console.error(`❌ [SOCKET LEAVE] ERROR calling leaveConversationRoom:`, error);
            process.stderr.write(`❌ [SOCKET LEAVE] ERROR: ${error?.message || error}\n`);
          }
          process.stdout.write(`[SOCKET LEAVE] leaveConversationRoom returned: ${wasRemoved}\n`);
        }
        
        // Verify user was removed (for debugging) - check multiple times to ensure consistency
        const stillInRoom1 = isUserInConversationRoom(userIdStr, conversationId);
        const stillInRoom2 = isUserInConversationRoom(userIdStr, conversationId); // Double check
        
        // Get current room state for verification
        const currentRoomUsers = getUsersInConversationRoom(conversationId);
        const isInRoomList = currentRoomUsers.includes(userIdStr);
        
        process.stdout.write(`[SOCKET LEAVE] AFTER: Room users: [${currentRoomUsers.join(", ")}]\n`);
        process.stdout.write(`[SOCKET LEAVE] Verification: stillInRoom1=${stillInRoom1}, stillInRoom2=${stillInRoom2}, isInRoomList=${isInRoomList}\n`);
        
        if (wasRemoved && !stillInRoom1 && !stillInRoom2 && !isInRoomList) {
          console.log(`[Leave Room] ✅ SUCCESS: User ${userIdStr} successfully removed from room ${conversationId}`);
          console.log(`[Leave Room] Current users in room: [${currentRoomUsers.join(", ")}]`);
        } else if (stillInRoom1 || stillInRoom2 || isInRoomList) {
          console.error(`[Leave Room] ❌ ERROR: User ${userIdStr} STILL in room ${conversationId} after leaving!`);
          console.error(`[Leave Room] wasRemoved: ${wasRemoved}, stillInRoom1: ${stillInRoom1}, stillInRoom2: ${stillInRoom2}, isInRoomList: ${isInRoomList}`);
          console.error(`[Leave Room] Current room users: [${currentRoomUsers.join(", ")}]`);
          
          // Force remove if still present (safety measure)
          if (wasInRoomBefore) {
            console.warn(`[Leave Room] Attempting force remove for user ${userIdStr}`);
            const forceRemoved = leaveConversationRoom(userIdStr, conversationId);
            console.warn(`[Leave Room] Force remove result: ${forceRemoved}`);
          }
        } else if (!wasRemoved && !wasInRoomBefore) {
          console.log(`[Leave Room] ℹ️ User ${userIdStr} was not in room ${conversationId} (already left or never joined)`);
        }
        
        socket.emit("conversation_left", { conversationId, userId: userIdStr });
     
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

        const receiverFcmTokens = getJsonArray<string>(receiverData?.fcmToken, []);

        // Send push only to receiver (via FCM tokens)
        if (receiverFcmTokens.length > 0) {
          const pushData: Record<string, string> = {
            type: "call_initiate",
            callerId: String(callerId),
            callType: String(callType),
            callerInfo: JSON.stringify({
              ...callerInfo,
              avatar: FileService.avatarUrl(callerInfo.avatar || ""),
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

            // Execute all push promises in parallel
            if (pushPromises.length > 0) {
              Promise.allSettled(pushPromises).catch(() => {});
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
      ({
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
        activeCalls.set(callerIdLocal, { ...callData, status: "in_call" });
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
      ({
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
          return;
        }

        const receiverSockets = getSocketsForUser(receiverId);
        if (!receiverSockets || receiverSockets.size === 0) {
          return;
        }

        // If call is already in "in_call" status, it means SDP exchange is complete
        // So we can send the candidate immediately without buffering
        if (
          senderCall.status === "in_call" &&
          receiverCall.status === "in_call"
        ) {
          io.to(receiverId).emit("webrtc_ice", { senderId, candidate });
        } else {
          // Buffer ICE candidate instead of sending immediately
          // This prevents race condition where candidates arrive before remote description
          const buffer = getIceCandidateBuffer(receiverId, senderId);
          buffer.push({
            candidate,
            timestamp: Date.now(),
          });
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
        // Send all buffered candidates to the peer
        const peerSockets = getSocketsForUser(peerId);
        if (peerSockets && peerSockets.size > 0) {
          bufferedCandidates.forEach((item) => {
            io.to(peerId).emit("webrtc_ice", {
              senderId: userId,
              candidate: item.candidate,
            });
          });
        }

        // Clear the buffer
        iceCandidateBuffers.delete(bufferKey);
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

              const opponentFcmTokens = getJsonArray<string>(opponentData?.fcmToken, []);
              if (opponentFcmTokens.length > 0) {
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
                  endedBy: String(endedByUserId),
                  callType: String(callType),
                  reason: wasAccepted ? "completed" : "canceled",
                };

                if (endedByUserInfo) {
                  pushData.endedByUser = JSON.stringify(endedByUserInfo);
                }

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
      "answer_complete",
      ({ receiverId, data }: { receiverId: string; data: any }) => {
        const senderId = getUserId();

        if (!senderId || !receiverId) {
          console.log("[answer_complete] Missing sender or receiver ID");
          return;
        }

        io.to(receiverId).emit("answer_complete", {
          senderId,
          data,
        });
      }
    );

    // 13. Answer Complete — forward to the opposite user
    // socket.on(
    //   "answer_complete",
    //   ({ receiverId, data }: { receiverId: string; data: any }) => {
    //     const senderId = getUserId();
    //     if (!senderId || !receiverId) return;

    //     const senderCall = activeCalls.get(senderId);
    //     const receiverCall = activeCalls.get(receiverId);
    //     console.log(receiverId, data);
    //     if (
    //       !senderCall ||
    //       !receiverCall ||
    //       senderCall.with !== receiverId ||
    //       receiverCall.with !== senderId
    //     ) {
    //       console.warn("[answer_complete] Users not in active call, ignoring");
    //       return;
    //     }

    //     const receiverSockets = getSocketsForUser(receiverId);
    //     if (receiverSockets && receiverSockets.size > 0) {
    //       console.log(
    //         `[answer_complete] Forwarding data from ${senderId} to ${receiverId}`,
    //         data
    //       );
    //       io.to(receiverId).emit("answer_complete", {
    //         senderId,
    //         data,
    //       });
    //     }
    //   }
    // );

    // 14. Call Offer Resend (caller resends offer if missed)
    // 14. Call Offer Resend (caller resends offer if missed)
    
    socket.on(
      "call_offer_resend",
      ({
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

        console.log("[CALL][OFFER_RESEND] Incoming request", {
          senderId,
          receiverId,
          callType,
        });

        if (!senderId || !receiverId) return;

        const existingCall = activeCalls.get(senderId);
        if (!existingCall || existingCall.with !== receiverId) return;

        const receiverSockets = getSocketsForUser(receiverId);
        if (!receiverSockets || receiverSockets.size === 0) return;

        // 🔥 SOFT RESET (same as call_end but without deleting call)
        clearIceCandidateBuffer(senderId, receiverId);

        // Reset state to calling (important)
        activeCalls.set(senderId, {
          ...existingCall,
          status: "calling",
        });
        activeCalls.set(receiverId, {
          with: senderId,
          status: "calling",
          type: existingCall.type,
        });

        console.log("[CALL][OFFER_RESEND] Soft reset done, resending offer");

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
    socket.on(
      "call_answer_recent",
      ({
        callerId,
        sdp,
      }: {
        callerId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const receiverId = getUserId();

        console.log("[CALL][ANSWER_RECENT] Receiver requested recent offer", {
          receiverId,
          callerId,
        });

        if (!receiverId || !callerId) {
          console.warn("[CALL][ANSWER_RECENT] Missing receiverId or callerId");
          return;
        }

        const callerData = activeCalls.get(callerId);

        if (!callerData) {
          console.warn(
            "[CALL][ANSWER_RECENT] No active call found for caller",
            {
              callerId,
            }
          );
          return;
        }

        if (callerData.with !== receiverId) {
          console.warn("[CALL][ANSWER_RECENT] Call partner mismatch", {
            expected: callerData.with,
            actual: receiverId,
          });
          return;
        }

        const callerSockets = getSocketsForUser(callerId);

        if (!callerSockets || callerSockets.size === 0) {
          console.warn("[CALL][ANSWER_RECENT] Caller is offline", {
            callerId,
          });
          return;
        }

        console.log("[CALL][ANSWER_RECENT] Notifying caller to resend offer", {
          callerId,
          socketCount: callerSockets.size,
        });

        io.to(callerId).emit("call_answer_recent", {
          receiverId,
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
        process.stdout.write(`[DISCONNECT] User ${userId} disconnected - last socket, removing from all rooms\n`);
        // Remove user from all conversation rooms
        const roomsToLeave: string[] = [];
        for (const [conversationId, room] of conversationRooms.entries()) {
          if (room.has(userId)) {
            roomsToLeave.push(conversationId);
          }
        }
        process.stdout.write(`[DISCONNECT] User ${userId} was in ${roomsToLeave.length} rooms: [${roomsToLeave.join(", ")}]\n`);
        roomsToLeave.forEach((conversationId) => {
            leaveConversationRoom(userId, conversationId);
        });
        process.stdout.write(`[DISCONNECT] User ${userId} removed from all rooms\n\n`);
      } else {
        process.stdout.write(`[DISCONNECT] User ${userId} disconnected but has ${remainingCount} other sockets - NOT removing from rooms\n`);
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