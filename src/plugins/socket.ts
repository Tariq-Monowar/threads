import fp from "fastify-plugin";
import { Server } from "socket.io";

export default fp(async (fastify) => {
  const io = new Server(fastify.server, {
    cors: { origin: "*" },
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
