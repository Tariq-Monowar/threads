import { FastifyInstance } from "fastify";
import { createConversation, createGroupChat, getMyConversationsList } from "./conversation.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const conversationRoutes = (fastify: FastifyInstance) => {
  fastify.post("/one-to-one", createConversation);
  fastify.get("/list/:myId", getMyConversationsList);
  fastify.post("/group", createGroupChat);
};

export default conversationRoutes;
