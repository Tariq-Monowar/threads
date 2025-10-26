///src/plugins/socket.ts
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

  // Track online users: userId -> socketId
  const onlineUsers = new Map<string, string>();

  io.on("connection", (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`);

    // --- USER JOIN EVENT ---
    // User connects and joins their personal room
    socket.on("join", (userId: string) => {
      onlineUsers.set(userId, socket.id);
      socket.join(userId);
      fastify.log.info(`User ${userId} joined personal room`);
      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // --- CONVERSATION ROOM MANAGEMENT ---
    // Join a conversation room (to receive messages)
    socket.on("join_conversation", ({ conversationId, userId }) => {
      socket.join(conversationId);
      fastify.log.info(`User ${userId} joined conversation: ${conversationId}`);
      
      // Notify others in the conversation
      socket.to(conversationId).emit("user_joined_conversation", { 
        conversationId, 
        userId 
      });
    });

    // Leave a conversation room
    socket.on("leave_conversation", ({ conversationId, userId }) => {
      socket.leave(conversationId);
      fastify.log.info(`User ${userId} left conversation: ${conversationId}`);
      
      // Notify others in the conversation
      socket.to(conversationId).emit("user_left_conversation", { 
        conversationId, 
        userId 
      });
    });

    // --- TYPING EVENTS ---
    socket.on("typing", ({ conversationId, userId, userName }) => {
      // Broadcast typing indicator to all others in the conversation
      socket.to(conversationId).emit("user_typing", {
        conversationId,
        userId,
        userName,
        isTyping: true
      });
    });

    socket.on("stop_typing", ({ conversationId, userId, userName }) => {
      // Broadcast stop typing indicator
      socket.to(conversationId).emit("user_stop_typing", {
        conversationId,
        userId,
        userName,
        isTyping: false
      });
    });

    // --- MESSAGE READ RECEIPTS ---
    socket.on("message_read", ({ conversationId, messageId, userId }) => {
      // Notify others in the conversation that a message was read
      socket.to(conversationId).emit("message_marked_read", {
        conversationId,
        messageId,
        userId,
        readAt: new Date()
      });
    });

    // --- DISCONNECT HANDLER ---
    socket.on("disconnect", () => {
      // Find and remove user from online users
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          fastify.log.info(`User ${userId} disconnected`);
          break;
        }
      }
      
      // Broadcast updated online users list
      io.emit("online-users", Array.from(onlineUsers.keys()));
      fastify.log.info(`Socket disconnected: ${socket.id}`);
    });
  });

  fastify.decorate("io", io);
});

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
  }
}
