"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const client_1 = require("@prisma/client");
exports.default = (0, fastify_plugin_1.default)(async (fastify) => {
    const prisma = new client_1.PrismaClient();
    await prisma.$connect();
    fastify.log.info("Database connected successfully");
    fastify.decorate("prisma", prisma);
    fastify.addHook("onClose", async () => {
        await prisma.$disconnect();
        fastify.log.info("Database disconnected successfully");
    });
});
//# sourceMappingURL=db.js.map