// // import fp from "fastify-plugin";
// // import { Server } from "socket.io";

// // export default fp(async (fastify) => {
// //   const io = new Server(fastify.server, {
// //     cors: {
// //       origin: [
// //         "http://localhost:5173",
// //         "http://localhost:3000",
// //         "http://127.0.0.1:50468",
// //         "http://localhost:4002",
// //         "http://127.0.0.1:5500",
// //       ],
// //       methods: ["GET", "POST"],
// //       credentials: true,
// //     },
// //   });

// //   const onlineUsers = new Map<string, string>();

// //   io.on("connection", (socket) => {
// //     fastify.log.info(`Socket connected: ${socket.id}`);

// //     // User connects and joins their personal room
// //     socket.on("join", (userId: string) => {
// //       onlineUsers.set(userId, socket.id);
// //       socket.join(userId);
// //       fastify.log.info(`User ${userId} connected`);
// //       io.emit("online-users", Array.from(onlineUsers.keys()));
// //     });

// //     // Typing indicators
// //     socket.on("typing", ({ conversationId, userId, userName }) => {
// //       socket.broadcast.emit("user_typing", {
// //         conversationId,
// //         userId,
// //         userName,
// //         isTyping: true
// //       });
// //     });

// //     socket.on("stop_typing", ({ conversationId, userId, userName }) => {
// //       socket.broadcast.emit("user_stop_typing", {
// //         conversationId,
// //         userId,
// //         userName,
// //         isTyping: false
// //       });
// //     });

// //     // Disconnect handler
// //     socket.on("disconnect", () => {
// //       for (const [userId, socketId] of onlineUsers.entries()) {
// //         if (socketId === socket.id) {
// //           onlineUsers.delete(userId);
// //           fastify.log.info(`User ${userId} disconnected`);
// //           break;
// //         }
// //       }
// //       io.emit("online-users", Array.from(onlineUsers.keys()));
// //       fastify.log.info(`Socket disconnected: ${socket.id}`);
// //     });
// //   });

// //   fastify.decorate("io", io);
// //   fastify.decorate("onlineUsers", onlineUsers);
// // });

// // declare module "fastify" {
// //   interface FastifyInstance {
// //     io: Server;
// //     onlineUsers: Map<string, string>;
// //   }
// // }

// import fp from "fastify-plugin";
// import { Server } from "socket.io";

// type CallType = "audio" | "video";
// type CallStatus = "calling" | "in_call";

// interface CallData {
//   with: string;
//   status: CallStatus;
//   type: CallType;
// }

// export default fp(async (fastify) => {
//   const io = new Server(fastify.server, {
//     cors: {
//       origin: [
//         "http://localhost:5173",
//         "http://localhost:3000",
//         "http://127.0.0.1:50468",
//         "http://localhost:4002",
//         "http://127.0.0.1:5500",
//       ],
//       methods: ["GET", "POST"],
//       credentials: true,
//     },
//   });

//   //state
//   const onlineUsers = new Map<string, string>();
//   const activeCalls = new Map<string, CallData>();

//   io.on("connection", (socket) => {
//     fastify.log.info(`New socket connected: ${socket.id}`);

//     // Helper: Get userId from socket (we'll set it on join)
//     const getUserId = () => {
//       for (const [userId, sid] of onlineUsers.entries()) {
//         if (sid === socket.id) return userId;
//       }
//       return null;
//     };

//     // 1. User Join
//     socket.on("join", (userId: string) => {
//       if (!userId) return;

//       onlineUsers.set(userId, socket.id);
//       socket.join(userId);
//       fastify.log.info(`User joined: ${userId}`);

//       io.emit("online-users", Array.from(onlineUsers.keys()));
//     });

//     // 2. Typing Indicators
//     socket.on(
//       "typing",
//       ({ targetUserId, conversationId, userName, userId }) => {
//         socket
//           .to(targetUserId)
//           .emit("user_typing", {
//             conversationId,
//             userId,
//             userName,
//             isTyping: true,
//           });
//       }
//     );

//     socket.on(
//       "stop_typing",
//       ({ targetUserId, conversationId, userName, userId }) => {
//         socket
//           .to(targetUserId)
//           .emit("user_stop_typing", {
//             conversationId,
//             userId,
//             userName,
//             isTyping: false,
//           });
//       }
//     );

//     // 3. Get online users
//     socket.on("get_online_users", () => {
//       socket.emit("online-users", Array.from(onlineUsers.keys()));
//     });

//     // 4. Call Initiate (A calls B)
//     socket.on(
//       "call_initiate",
//       ({
//         fromUserId,
//         toUserId,
//         callType = "audio",
//       }: {
//         fromUserId: string;
//         toUserId: string;
//         callType: CallType;
//       }) => {
//         if (!fromUserId || !toUserId) return;

//         if (!onlineUsers.has(toUserId)) {
//           socket.emit("call_failed", { message: "User is offline" });
//           return;
//         }

//         if (activeCalls.has(toUserId)) {
//           socket.emit("call_busy", { message: "User is busy" });
//           return;
//         }

//         // Mark both as calling
//         activeCalls.set(fromUserId, {
//           with: toUserId,
//           status: "calling",
//           type: callType,
//         });
//         activeCalls.set(toUserId, {
//           with: fromUserId,
//           status: "calling",
//           type: callType,
//         });

//         const receiverSocketId = onlineUsers.get(toUserId);
//         if (receiverSocketId) {
//           io.to(receiverSocketId).emit("call_incoming", {
//             fromUserId,
//             callType,
//           });
//         }

//         fastify.log.info(`${fromUserId} calling ${toUserId} (${callType})`);
//       }
//     );

//     // 5. Call Accept
//     socket.on(
//       "call_accept",
//       ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
//         const callerId = fromUserId;
//         const calleeId = toUserId;

//         const callData = activeCalls.get(callerId);
//         if (!callData || callData.with !== calleeId) return;

//         // Update status to in_call
//         activeCalls.set(callerId, { ...callData, status: "in_call" });
//         activeCalls.set(calleeId, {
//           with: callerId,
//           status: "in_call",
//           type: callData.type,
//         });

//         const callerSocketId = onlineUsers.get(callerId);
//         if (callerSocketId) {
//           io.to(callerSocketId).emit("call_accepted", {
//             fromUserId: calleeId,
//             callType: callData.type,
//           });
//         }

//         fastify.log.info(`Call accepted: ${callerId} ↔ ${calleeId}`);
//       }
//     );

//     // 6. WebRTC Offer (SDP Offer)
//     socket.on(
//       "webrtc_offer",
//       ({
//         toUserId,
//         sdp,
//       }: {
//         toUserId: string;
//         sdp: RTCSessionDescriptionInit;
//       }) => {
//         const fromUserId = getUserId();
//         if (!fromUserId || !toUserId) return;

//         const targetSocketId = onlineUsers.get(toUserId);
//         if (targetSocketId) {
//           io.to(targetSocketId).emit("webrtc_offer", { fromUserId, sdp });
//         }
//       }
//     );

//     // 7. WebRTC Answer (SDP Answer)
//     socket.on(
//       "webrtc_answer",
//       ({
//         toUserId,
//         sdp,
//       }: {
//         toUserId: string;
//         sdp: RTCSessionDescriptionInit;
//       }) => {
//         const fromUserId = getUserId();
//         if (!fromUserId || !toUserId) return;

//         const targetSocketId = onlineUsers.get(toUserId);
//         if (targetSocketId) {
//           io.to(targetSocketId).emit("webrtc_answer", { fromUserId, sdp });
//         }
//       }
//     );

//     // 8. ICE Candidate
//     socket.on(
//       "webrtc_ice",
//       ({
//         toUserId,
//         candidate,
//       }: {
//         toUserId: string;
//         candidate: RTCIceCandidate;
//       }) => {
//         const fromUserId = getUserId();
//         if (!fromUserId || !toUserId) return;

//         const targetSocketId = onlineUsers.get(toUserId);
//         if (targetSocketId) {
//           io.to(targetSocketId).emit("webrtc_ice", { fromUserId, candidate });
//         }
//       }
//     );

//     // 9. Call Decline
//     socket.on(
//       "call_decline",
//       ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
//         activeCalls.delete(fromUserId);
//         activeCalls.delete(toUserId);

//         const callerSocketId = onlineUsers.get(fromUserId);
//         if (callerSocketId) {
//           io.to(callerSocketId).emit("call_declined", { fromUserId: toUserId });
//         }
//       }
//     );

//     // 10. Call End
//     socket.on(
//       "call_end",
//       ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
//         activeCalls.delete(fromUserId);
//         activeCalls.delete(toUserId);

//         const peerSocketId = onlineUsers.get(toUserId);
//         if (peerSocketId) {
//           io.to(peerSocketId).emit("call_ended", { fromUserId });
//         }
//       }
//     );

//     // 11. Disconnect - Cleanup
//     socket.on("disconnect", () => {
//       const userId = getUserId();
//       if (!userId) return;

//       onlineUsers.delete(userId);

//       if (activeCalls.has(userId)) {
//         const call = activeCalls.get(userId)!;
//         const peerId = call.with;
//         activeCalls.delete(userId);
//         activeCalls.delete(peerId);

//         const peerSocketId = onlineUsers.get(peerId);
//         if (peerSocketId) {
//           io.to(peerSocketId).emit("call_ended", {
//             fromUserId: userId,
//             reason: "disconnected",
//           });
//         }
//       }

//       io.emit("online-users", Array.from(onlineUsers.keys()));
//       fastify.log.info(`User disconnected: ${userId}`);
//     });
//   });

//   // Decorate Fastify instance
//   fastify.decorate("io", io);
//   fastify.decorate("onlineUsers", onlineUsers);
//   fastify.decorate("activeCalls", activeCalls);
// });

// declare module "fastify" {
//   interface FastifyInstance {
//     io: Server;
//     onlineUsers: Map<string, string>;
//     activeCalls: Map<string, CallData>;
//   }
// }

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

    // 4. Call Initiate (A calls B)
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

    // 5. Call Accept
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

    // 6. WebRTC Offer (SDP Offer)
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

    // 7. WebRTC Answer (SDP Answer)
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

    // 8. ICE Candidate
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

    // 9. Call Decline
    socket.on(
      "call_decline",
      ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
        activeCalls.delete(callerId);
        activeCalls.delete(receiverId);

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

    // 10. Call End
    // 10. Call End - Fixed version
    socket.on(
      "call_end",
      ({ callerId, receiverId }: { callerId: string; receiverId: string }) => {
        const endedByUserId = getUserId(); // কে কল শেষ করছে
        if (!endedByUserId) return;

        // ভেরিফিকেশন: আসলে এই ইউজাররা একে অপরের সাথে কল করছে কিনা
        const callerCall = activeCalls.get(callerId);
        const receiverCall = activeCalls.get(receiverId);

        // শুধুমাত্র ডিলিট করবেন যদি তারা সত্যিই একে অপরের সাথে কল করছে
        if (
          callerCall &&
          callerCall.with === receiverId &&
          receiverCall &&
          receiverCall.with === callerId
        ) {
          activeCalls.delete(callerId);
          activeCalls.delete(receiverId);

          // শুধুমাত্র প্রতিপক্ষকে নোটিফাই করুন
          const opponentId = endedByUserId === callerId ? receiverId : callerId;
          const opponentSocketId = onlineUsers.get(opponentId);

          if (opponentSocketId && opponentSocketId !== socket.id) {
            io.to(opponentSocketId).emit("call_ended", {
              endedBy: endedByUserId,
              reason: "ended_by_user",
            });
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

    // 11. Disconnect - Cleanup
    socket.on("disconnect", () => {
      const userId = getUserId();
      if (!userId) return;

      onlineUsers.delete(userId);

      if (activeCalls.has(userId)) {
        const call = activeCalls.get(userId)!;
        const peerId = call.with;
        activeCalls.delete(userId);
        activeCalls.delete(peerId);

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
});

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
    onlineUsers: Map<string, string>;
    activeCalls: Map<string, CallData>;
  }
}