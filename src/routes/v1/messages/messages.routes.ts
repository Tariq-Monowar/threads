import { FastifyInstance } from "fastify";
import { 
  deleteMessage, 
  sendMessage, 
  deleteMessageForMe, 
  deleteMessageForEveryone, 
  getMessages,
  markMultipleMessagesAsRead
} from "./messages.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const messageRoutes = (fastify: FastifyInstance) => {
  fastify.post("/send", sendMessage);
  fastify.get("/get-messages/:conversationId", getMessages);
  fastify.delete("/messages/:messageId", deleteMessage);
  fastify.delete("/delete-for-me/:messageId", deleteMessageForMe);
  fastify.delete("/delete-for-everyone/:messageId", deleteMessageForEveryone);
  fastify.patch("/mark-as-read/:conversationId", markMultipleMessagesAsRead);
};

export default messageRoutes;
