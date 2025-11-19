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

// Type definitions for better readability
type CallType = "audio" | "video";
type CallStatus = "calling" | "in_call";

interface CallData {
  with: string;      // Other user's ID
  status: CallStatus;
  type: CallType;    // New: Audio or Video
}

export default fp(async (fastify) => {
  // Initialize Socket.io server with CORS
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

  // Maps for state management (userId -> value)
  const onlineUsers = new Map<string, string>();   
  const activeCalls = new Map<string, CallData>(); 

  // Connection handler: Runs when a client connects
  // ALL COMMENTS MUST REMAIN IN ENGLISH
  io.on("connection", (socket) => {
    fastify.log.info(`New socket connected: ${socket.id}`);

    // ================================
    // ১. ইউজার জয়েন (User Join)
    // ================================
    socket.on("join", (userId: string) => {
      if (!userId) {
        fastify.log.warn("জয়েন রিকোয়েস্টে userId নেই!");
        return;
      }

      onlineUsers.set(userId, socket.id);
      socket.join(userId);  // Personal room for private messages/calls

      fastify.log.info(`User joined: ${userId}`);
      
      // Broadcast updated online list to all
      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // ================================
    // ২. টাইপিং ইন্ডিকেটর (Typing Indicators) - শুধু টার্গেট ইউজারকে
    // ================================
    socket.on("typing", ({ conversationId, targetUserId, userName, userId }: {
      conversationId: string;
      targetUserId: string;
      userName: string;
      userId: string;
    }) => {
      if (!targetUserId) return;  // No target? Skip

      // Emit only to the target user
      socket.to(targetUserId).emit("user_typing", {
        conversationId,
        userId,
        userName,
        isTyping: true,
      });
    });

    socket.on("stop_typing", ({ conversationId, targetUserId, userName, userId }: {
      conversationId: string;
      targetUserId: string;
      userName: string;
      userId: string;
    }) => {
      if (!targetUserId) return;

      socket.to(targetUserId).emit("user_stop_typing", {
        conversationId,
        userId,
        userName,
        isTyping: false,
      });
    });

    // ================================
    // ৩. অনলাইন ইউজারস লিস্ট রিকোয়েস্ট (Get Online Users)
    // ================================
    socket.on("get_online_users", () => {
      socket.emit("online-users", Array.from(onlineUsers.keys()));  // Only to requester
    });

    // ================================
    // ৪. কল শুরু করা (Initiate Call) - নতুন: callType সাপোর্ট
    // ================================
    socket.on("call_initiate", ({
      fromUserId,
      toUserId,
      callType = "audio"  // Default: Audio for privacy
    }: {
      fromUserId: string;
      toUserId: string;
      callType?: CallType;
    }) => {

      if (!fromUserId || !toUserId || !callType) {

        socket.emit("call_failed", { message: "Incomplete information!" });
        return;
      }

      // Check if receiver is online
      if (!onlineUsers.has(toUserId)) {
        socket.emit("call_failed", { message: "User not online!" });
        return;
      }

      // Check if receiver is busy
      if (activeCalls.has(toUserId)) {
        socket.emit("call_busy", { message: "User is busy!" });
        return;
      }

      // Create call session for both users
      activeCalls.set(fromUserId, { with: toUserId, status: "calling", type: callType });
      activeCalls.set(toUserId, { with: fromUserId, status: "calling", type: callType });

      // Notify receiver (incoming call)
      const receiverSocket = onlineUsers.get(toUserId);
      if (receiverSocket) {
        io.to(receiverSocket).emit("call_incoming", {
          fromUserId,
          callType,  // Pass type for UI (e.g., show video icon)
        });
      }

      fastify.log.info(`Call initiated: ${fromUserId} → ${toUserId} (${callType})`);
    });


    // ================================
    // ৫. কল অ্যাক্সেপ্ট (Accept Call)
    // ================================
    socket.on("call_accept", ({ fromUserId, toUserId }: {
      fromUserId: string;
      toUserId: string;
    }) => {
      if (!fromUserId || !toUserId) {
        socket.emit("call_failed", { message: "Missing caller or callee" });
        return;
      }

      const callerId = fromUserId;
      const calleeId = toUserId;

      // Get existing call data
      const callData = activeCalls.get(callerId);
      if (!callData || callData.with !== calleeId) {
        socket.emit("call_failed", { message: "Call session not found" });
        return;
      }

      // Update status to in_call for both
      const updatedCall: CallData = { with: calleeId, status: "in_call", type: callData.type };
      activeCalls.set(callerId, updatedCall);
      activeCalls.set(calleeId, { ...updatedCall, with: callerId });

      // Notify caller
      const callerSocket = onlineUsers.get(callerId);
      if (callerSocket) {
        io.to(callerSocket).emit("call_accepted", {
          fromUserId: calleeId,
          callType: callData.type,
        });
      }

      fastify.log.info(`Call accepted: ${callerId} ↔ ${calleeId}`);
    });

    // ================================
    // ৬. কল ডিক্লাইন (Decline Call)
    // ================================
    socket.on("call_decline", ({ fromUserId, toUserId }: {
      fromUserId: string;
      toUserId: string;
    }) => {
      if (!fromUserId || !toUserId) return;

      const callerId = fromUserId;
      const calleeId = toUserId;

      // Clean up call session
      activeCalls.delete(callerId);
      activeCalls.delete(calleeId);

      // Notify caller
      const callerSocket = onlineUsers.get(callerId);
      if (callerSocket) {
        io.to(callerSocket).emit("call_declined", { fromUserId: calleeId });
      }

      fastify.log.info(`কল ডিক্লাইন: ${fromUserId} ← ${toUserId}`);
    });

    // ================================
    // 7. End call
    // ================================
    socket.on("call_end", ({ fromUserId, toUserId }: {
      fromUserId: string;
      toUserId: string;
    }) => {
      if (!fromUserId || !toUserId) return;

      // Clean up
      activeCalls.delete(fromUserId);
      activeCalls.delete(toUserId);

      // Notify peer
      const peerSocket = onlineUsers.get(toUserId);
      if (peerSocket) {
        io.to(peerSocket).emit("call_ended", { fromUserId });
      }

      fastify.log.info(`Call ended: ${fromUserId} ↔ ${toUserId}`);
    });

    // ================================
    // 8. WebRTC signaling (SDP/ICE)
    // ================================
    socket.on("call_signal", ({ fromUserId, toUserId, signal }: {
      fromUserId: string;
      toUserId: string;
      signal: any;  // SDP or ICE candidate
    }) => {
      const receiverSocket = onlineUsers.get(toUserId);
      if (receiverSocket) {
        io.to(receiverSocket).emit("call_signal", {
          fromUserId,
          signal,
        });
      }
    });

    // ================================
    // ৯. ডিসকানেক্ট (Disconnect) - কল ক্লিনআপ সহ
    // ================================
    socket.on("disconnect", () => {
      let disconnectedUser: string | null = null;

      // Find and remove user from online list
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          disconnectedUser = userId;
          break;
        }
      }

      // If in call, end it forcefully
      if (disconnectedUser && activeCalls.has(disconnectedUser)) {
        const callData = activeCalls.get(disconnectedUser)!;
        const peer = callData.with;
        const peerSocket = onlineUsers.get(peer);

        // Clean up both
        activeCalls.delete(disconnectedUser);
        activeCalls.delete(peer);

        // Notify peer
        if (peerSocket) {
          io.to(peerSocket).emit("call_ended", {
            fromUserId: disconnectedUser,
            reason: "user_disconnected",
          });
        }
      }

      // Broadcast updated online list
      io.emit("online-users", Array.from(onlineUsers.keys()));
      
      fastify.log.info(`Socket disconnected: ${socket.id} (user: ${disconnectedUser || "unknown"})`);
    });
  });

  // Decorate Fastify instance for use in routes
  fastify.decorate("io", io);
  fastify.decorate("onlineUsers", onlineUsers);
  fastify.decorate("activeCalls", activeCalls);
});

// Type declarations for Fastify (IntelliSense support)
declare module "fastify" {
  interface FastifyInstance {
    io: Server;
    onlineUsers: Map<string, string>;
    activeCalls: Map<string, CallData>;
  }
}