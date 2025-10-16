"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const ioredis_1 = __importDefault(require("ioredis"));
exports.default = (0, fastify_plugin_1.default)(async (fastify) => {
    const redis = new ioredis_1.default(process.env.REDIS_URL);
    redis.on("connect", () => fastify.log.info("Redis connected successfully"));
    redis.on("error", (err) => fastify.log.error(`Redis error: ${err.message}`));
    fastify.decorate("redis", redis);
    fastify.addHook("onClose", async () => {
        await redis.quit();
        fastify.log.info("Redis disconnected successfully");
    });
});
//# sourceMappingURL=redis.js.map