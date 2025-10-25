import { FastifyInstance } from "fastify";
import { createConversation, deleteConversationForMe } from "./private.controllers";
import { upload } from "../../../../config/storage.config";
import { verifyUser } from "../../../../middleware/auth.middleware";

const conversationRoutes = (fastify: FastifyInstance) => {
  fastify.post("/create", createConversation);
  fastify.delete("/:conversationId/delete-for-me", deleteConversationForMe);
};

export default conversationRoutes;
