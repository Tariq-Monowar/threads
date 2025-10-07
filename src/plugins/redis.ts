import fp from "fastify-plugin";
import Redis from "ioredis";

export default fp(async (fastify) => {
  const redis = new Redis(process.env.REDIS_URL);

  redis.on("connect", () => fastify.log.info("Redis connected successfully"));
  redis.on("error", (err) => fastify.log.error(`Redis error: ${err.message}`));

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
    fastify.log.info("Redis disconnected successfully");
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}
