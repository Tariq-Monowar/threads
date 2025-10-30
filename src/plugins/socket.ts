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

  const onlineUsers = new Map<string, string>();

  io.on("connection", (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`);

    // User connects and joins their personal room
    socket.on("join", (userId: string) => {
      onlineUsers.set(userId, socket.id);
      socket.join(userId);
      fastify.log.info(`User ${userId} connected`);
      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    // Typing indicators
    socket.on("typing", ({ conversationId, userId, userName }) => {
      socket.broadcast.emit("user_typing", {
        conversationId,
        userId,
        userName,
        isTyping: true
      });
    });

    socket.on("stop_typing", ({ conversationId, userId, userName }) => {
      socket.broadcast.emit("user_stop_typing", {
        conversationId,
        userId,
        userName,
        isTyping: false
      });
    });

    // Disconnect handler
    socket.on("disconnect", () => {
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          fastify.log.info(`User ${userId} disconnected`);
          break;
        }
      }
      io.emit("online-users", Array.from(onlineUsers.keys()));
      fastify.log.info(`Socket disconnected: ${socket.id}`);
    });
  });

  fastify.decorate("io", io);
  fastify.decorate("onlineUsers", onlineUsers);
});

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
    onlineUsers: Map<string, string>;
  }
}