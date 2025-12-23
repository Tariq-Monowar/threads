import { FastifyInstance } from "fastify";
import { blockUser, unblockUser, getBlockList } from "./block.controllers";

const blockRoutes = (fastify: FastifyInstance) => {
  fastify.post("/add", blockUser);
  fastify.post("/remove", unblockUser);
  fastify.get("/list/:myId", getBlockList);
};

export default blockRoutes;
