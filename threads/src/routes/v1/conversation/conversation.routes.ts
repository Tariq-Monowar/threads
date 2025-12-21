import { FastifyInstance } from "fastify";
import { getMyConversationsList, getSingleConversation } from "./conversation.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const privateRoutes = (fastify: FastifyInstance) => {
  fastify.get("/list/:myId", getMyConversationsList);
  fastify.get("/:conversationId", getSingleConversation);
};

export default privateRoutes;
