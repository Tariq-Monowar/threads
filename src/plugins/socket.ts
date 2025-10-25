///src/plugins/socket.ts
import fp from "fastify-plugin";
import { Server } from "socket.io";

export default fp(async (fastify) => {
  const io = new Server(fastify.server, {
    cors: { 
      origin: ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:50468", "http://localhost:4002", "http://127.0.0.1:5500"],
      methods: ["GET", "POST"],
      credentials: true
    },
  });

  io.on("connection", (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`);

    socket.on("join_room", ({ roomId, userType }) => {
      socket.join(roomId);

      if (userType === "admin") {
        fastify.log.info(`Admin joined room: ${roomId}`);
      } else {
        fastify.log.info(`User joined their room: ${roomId}`);
      }
    });

    // --- TYPING EVENTS ---
    socket.on("typing", ({ roomId, user }) => { 
      socket.to(roomId).emit("user_typing", user);
    });

    socket.on("stop_typing", ({ roomId, user }) => {
      socket.to(roomId).emit("user_stop_typing", user);
    });

    socket.on("disconnect", () => {
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
