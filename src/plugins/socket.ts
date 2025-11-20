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

import fp from "fastify-plugin";
import { Server } from "socket.io";

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
        socket
          .to(targetUserId)
          .emit("user_typing", {
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
        socket
          .to(targetUserId)
          .emit("user_stop_typing", {
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
      ({
        fromUserId,
        toUserId,
        callType = "audio",
      }: {
        fromUserId: string;
        toUserId: string;
        callType: CallType;
      }) => {
        if (!fromUserId || !toUserId) return;

        if (!onlineUsers.has(toUserId)) {
          socket.emit("call_failed", { message: "User is offline" });
          return;
        }

        if (activeCalls.has(toUserId)) {
          socket.emit("call_busy", { message: "User is busy" });
          return;
        }

        // Mark both as calling
        activeCalls.set(fromUserId, {
          with: toUserId,
          status: "calling",
          type: callType,
        });
        activeCalls.set(toUserId, {
          with: fromUserId,
          status: "calling",
          type: callType,
        });

        const receiverSocketId = onlineUsers.get(toUserId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("call_incoming", {
            fromUserId,
            callType,
          });
        }

        fastify.log.info(`${fromUserId} calling ${toUserId} (${callType})`);
      }
    );

    // 5. Call Accept
    socket.on(
      "call_accept",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        const callerId = fromUserId;
        const calleeId = toUserId;

        const callData = activeCalls.get(callerId);
        if (!callData || callData.with !== calleeId) return;

        // Update status to in_call
        activeCalls.set(callerId, { ...callData, status: "in_call" });
        activeCalls.set(calleeId, {
          with: callerId,
          status: "in_call",
          type: callData.type,
        });

        const callerSocketId = onlineUsers.get(callerId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("call_accepted", {
            fromUserId: calleeId,
            callType: callData.type,
          });
        }

        fastify.log.info(`Call accepted: ${callerId} ↔ ${calleeId}`);
      }
    );

    // 6. WebRTC Offer (SDP Offer)
    socket.on(
      "webrtc_offer",
      ({
        toUserId,
        sdp,
      }: {
        toUserId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const fromUserId = getUserId();
        if (!fromUserId || !toUserId) return;

        const targetSocketId = onlineUsers.get(toUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("webrtc_offer", { fromUserId, sdp });
        }
      }
    );

    // 7. WebRTC Answer (SDP Answer)
    socket.on(
      "webrtc_answer",
      ({
        toUserId,
        sdp,
      }: {
        toUserId: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        const fromUserId = getUserId();
        if (!fromUserId || !toUserId) return;

        const targetSocketId = onlineUsers.get(toUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("webrtc_answer", { fromUserId, sdp });
        }
      }
    );

    // 8. ICE Candidate
    socket.on(
      "webrtc_ice",
      ({
        toUserId,
        candidate,
      }: {
        toUserId: string;
        candidate: RTCIceCandidate;
      }) => {
        const fromUserId = getUserId();
        if (!fromUserId || !toUserId) return;

        const targetSocketId = onlineUsers.get(toUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit("webrtc_ice", { fromUserId, candidate });
        }
      }
    );

    // 9. Call Decline
    socket.on(
      "call_decline",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        activeCalls.delete(fromUserId);
        activeCalls.delete(toUserId);

        const callerSocketId = onlineUsers.get(fromUserId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("call_declined", { fromUserId: toUserId });
        }
      }
    );

    // 10. Call End
    socket.on(
      "call_end",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        activeCalls.delete(fromUserId);
        activeCalls.delete(toUserId);

        const peerSocketId = onlineUsers.get(toUserId);
        if (peerSocketId) {
          io.to(peerSocketId).emit("call_ended", { fromUserId });
        }
      }
    );

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
            fromUserId: userId,
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
