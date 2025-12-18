import { FastifyInstance } from "fastify";
import { createConversation, deleteConversationForMe, getConversationsByUserId } from "./private.controllers";
import { upload } from "../../../../config/storage.config";
import { verifyUser } from "../../../../middleware/auth.middleware";

const conversationRoutes = (fastify: FastifyInstance) => {
  fastify.post("/create", createConversation);
  fastify.delete("/:conversationId/delete-for-me", deleteConversationForMe);
  //i need to get convercation using user id
  fastify.post("/get", getConversationsByUserId);

};

export default conversationRoutes;
