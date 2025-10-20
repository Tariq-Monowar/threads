import { FastifyInstance } from "fastify";
import {
  addUsersToGroup,
  createConversation,
  createGroupChat,
  getMyConversationsList,
  removeUsersFromGroup,
  updateGroupPermissions,
} from "./conversation.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const conversationRoutes = (fastify: FastifyInstance) => {
  fastify.post("/one-to-one", createConversation);
  fastify.get("/list/:myId", getMyConversationsList);

  fastify.post("/group", createGroupChat);
  fastify.patch("/group/permissions", updateGroupPermissions);
  fastify.post("/group/:conversationId/add-users", addUsersToGroup);
  fastify.delete("/group/:conversationId/remove-users", removeUsersFromGroup);
};

export default conversationRoutes;
