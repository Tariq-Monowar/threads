import { FastifyInstance } from "fastify";
import { createConversation } from "./conversation.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const conversationRoutes = (fastify: FastifyInstance) => {
  fastify.post("/one-to-one", createConversation);
};

export default conversationRoutes;
