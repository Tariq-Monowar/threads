// import fp from "fastify-plugin";
// import { Server } from "socket.io";

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

//   const onlineUsers = new Map<string, string>();

//   io.on("connection", (socket) => {
//     fastify.log.info(`Socket connected: ${socket.id}`);

//     // User connects and joins their personal room
//     socket.on("join", (userId: string) => {
//       onlineUsers.set(userId, socket.id);
//       socket.join(userId);
//       fastify.log.info(`User ${userId} connected`);
//       io.emit("online-users", Array.from(onlineUsers.keys()));
//     });

//     // Typing indicators
//     socket.on("typing", ({ conversationId, userId, userName }) => {
//       socket.broadcast.emit("user_typing", {
//         conversationId,
//         userId,
//         userName,
//         isTyping: true
//       });
//     });

//     socket.on("stop_typing", ({ conversationId, userId, userName }) => {
//       socket.broadcast.emit("user_stop_typing", {
//         conversationId,
//         userId,
//         userName,
//         isTyping: false
//       });
//     });

//     // Disconnect handler
//     socket.on("disconnect", () => {
//       for (const [userId, socketId] of onlineUsers.entries()) {
//         if (socketId === socket.id) {
//           onlineUsers.delete(userId);
//           fastify.log.info(`User ${userId} disconnected`);
//           break;
//         }
//       }
//       io.emit("online-users", Array.from(onlineUsers.keys()));
//       fastify.log.info(`Socket disconnected: ${socket.id}`);
//     });
//   });

//   fastify.decorate("io", io);
//   fastify.decorate("onlineUsers", onlineUsers);
// });

// declare module "fastify" {
//   interface FastifyInstance {
//     io: Server;
//     onlineUsers: Map<string, string>;
//   }
// }


import fp from "fastify-plugin";
import { Server } from "socket.io";

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

  // userId -> socketId
  const onlineUsers = new Map<string, string>();

  // userId -> { with: otherUserId, status: 'calling' | 'in_call' }
  const activeCalls = new Map<
    string,
    { with: string; status: "calling" | "in_call" }
  >();

  io.on("connection", (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`);

    // -----------------------------
    // USER JOIN
    // -----------------------------
    socket.on("join", (userId: string) => {
      if (!userId) return;

      onlineUsers.set(userId, socket.id);
      socket.join(userId);

      fastify.log.info(`User ${userId} joined`);

      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // -----------------------------
    // TYPING (fix: only to the other user)
    // -----------------------------
    socket.on(
      "typing",
      ({ conversationId, targetUserId, userName, userId }) => {
        if (!targetUserId) return;
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
      ({ conversationId, targetUserId, userName, userId }) => {
        if (!targetUserId) return;
        socket.to(targetUserId).emit("user_stop_typing", {
          conversationId,
          userId,
          userName,
          isTyping: false,
        });
      }
    );


    // -----------------------------
    // GET ONLINE USERS
    // -----------------------------
    socket.on("get_online_users", () => {
      io.emit("online-users", Array.from(onlineUsers.keys()));
    });
    

    // -----------------------------
    // INITIATE CALL
    // -----------------------------
    socket.on(
      "call_initiate",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        if (!fromUserId || !toUserId) return;

        // Receiver offline?
        if (!onlineUsers.has(toUserId)) {
          return socket.emit("call_failed", {
            message: "User is offline",
          });
        }

        // Busy check
        if (activeCalls.has(toUserId)) {
          return socket.emit("call_busy", {
            message: "User is in another call",
          });
        }

        // Create call session
        activeCalls.set(fromUserId, {
          with: toUserId,
          status: "calling",
        });

        activeCalls.set(toUserId, {
          with: fromUserId,
          status: "calling",
        });

        const receiverSocket = onlineUsers.get(toUserId);
        if (receiverSocket) {
          io.to(receiverSocket).emit("call_incoming", {
            fromUserId,
          });
        }
      }
    );

    // -----------------------------
    // CALL ACCEPT
    // -----------------------------
    socket.on(
      "call_accept",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        activeCalls.set(fromUserId, {
          with: toUserId,
          status: "in_call",
        });

        activeCalls.set(toUserId, {
          with: fromUserId,
          status: "in_call",
        });

        const callerSocket = onlineUsers.get(toUserId);
        if (callerSocket) {
          io.to(callerSocket).emit("call_accepted", { fromUserId });
        }
      }
    );

    // -----------------------------
    // CALL DECLINE
    // -----------------------------
    socket.on(
      "call_decline",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        activeCalls.delete(fromUserId);
        activeCalls.delete(toUserId);

        const callerSocket = onlineUsers.get(toUserId);
        if (callerSocket) {
          io.to(callerSocket).emit("call_declined", { fromUserId });
        }
      }
    );

    // -----------------------------
    // CALL END
    // -----------------------------
    socket.on(
      "call_end",
      ({ fromUserId, toUserId }: { fromUserId: string; toUserId: string }) => {
        activeCalls.delete(fromUserId);
        activeCalls.delete(toUserId);

        const receiverSocket = onlineUsers.get(toUserId);
        if (receiverSocket) {
          io.to(receiverSocket).emit("call_ended", { fromUserId });
        }
      }
    );

    // -----------------------------
    // SIGNALING (WebRTC)
    // -----------------------------
    socket.on("call_signal", ({ fromUserId, toUserId, signal }) => {
      const receiverSocket = onlineUsers.get(toUserId);
      if (receiverSocket) {
        io.to(receiverSocket).emit("call_signal", {
          fromUserId,
          signal,
        });
      }
    });

    // -----------------------------
    // DISCONNECT
    // -----------------------------
    socket.on("disconnect", () => {
      let disconnectedUser: string | null = null;

      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          disconnectedUser = userId;
          break;
        }
      }

      // If user was in a call → end it
      if (disconnectedUser && activeCalls.has(disconnectedUser)) {
        const callData = activeCalls.get(disconnectedUser)!;

        const peer = callData.with;
        const peerSocket = onlineUsers.get(peer);

        activeCalls.delete(disconnectedUser);
        activeCalls.delete(peer);

        if (peerSocket) {
          io.to(peerSocket).emit("call_ended", {
            fromUserId: disconnectedUser,
            reason: "user_disconnected",
          });
        }
      }

      io.emit("online-users", Array.from(onlineUsers.keys()));
      fastify.log.info(`Socket disconnected: ${socket.id}`);
    });
  });

  fastify.decorate("io", io);
  fastify.decorate("onlineUsers", onlineUsers);
  fastify.decorate("activeCalls", activeCalls);
});

// Fastify type
declare module "fastify" {
  interface FastifyInstance {
    io: Server;
    onlineUsers: Map<string, string>;
    activeCalls: Map<string, { with: string; status: string }>;
  }
}
