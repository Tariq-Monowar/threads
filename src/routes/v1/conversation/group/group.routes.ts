import { FastifyInstance } from "fastify";
import {
  addUsersToGroup,
  createGroupChat,
  removeUsersFromGroup,
  updateGroupPermissions,
  leaveFromGroup,
  makeGroupAdmin,
  removeGroupAdmin,
  destroyGroup,
} from "./group.controllers";
import { upload } from "../../../../config/storage.config";
import { verifyUser } from "../../../../middleware/auth.middleware";

const groupRoutes = (fastify: FastifyInstance) => {
  fastify.post("/", createGroupChat);
  fastify.patch("/permissions", updateGroupPermissions);
  fastify.post("/:conversationId/add-users", addUsersToGroup);
  fastify.delete("/:conversationId/remove-users", removeUsersFromGroup);
  fastify.post("/:conversationId/leave", leaveFromGroup);
  fastify.post("/:conversationId/make-admin", makeGroupAdmin);
  fastify.post("/:conversationId/remove-admin", removeGroupAdmin);
  fastify.delete("/:conversationId/destroy", destroyGroup);
};

export default groupRoutes;
