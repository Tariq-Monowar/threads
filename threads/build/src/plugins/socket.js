"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const socket_io_1 = require("socket.io");
exports.default = (0, fastify_plugin_1.default)(async (fastify) => {
    const io = new socket_io_1.Server(fastify.server, {
        cors: { origin: "*" },
    });
    io.on("connection", (socket) => {
        fastify.log.info(`Socket connected: ${socket.id}`);
        socket.on("join_room", ({ roomId, userType }) => {
            socket.join(roomId);
            if (userType === "admin") {
                fastify.log.info(`Admin joined room: ${roomId}`);
            }
            else {
                fastify.log.info(`User joined their room: ${roomId}`);
            }
        });
        socket.on("disconnect", () => {
            fastify.log.info(`Socket disconnected: ${socket.id}`);
        });
    });
    fastify.decorate("io", io);
});
//# sourceMappingURL=socket.js.map