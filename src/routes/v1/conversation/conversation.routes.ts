import { FastifyInstance } from "fastify";
import { createConversation, getMyConversationsList } from "./conversation.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const conversationRoutes = (fastify: FastifyInstance) => {
  fastify.post("/one-to-one", createConversation);
  fastify.get("/list/:myId", getMyConversationsList);
};

export default conversationRoutes;
