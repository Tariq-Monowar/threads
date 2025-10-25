import { FastifyInstance } from "fastify";
import {
  addUsersToGroup,
  createGroupChat,
  removeUsersFromGroup,
  updateGroupPermissions,
} from "./group.controllers";
import { upload } from "../../../../config/storage.config";
import { verifyUser } from "../../../../middleware/auth.middleware";

const grupRoutes = (fastify: FastifyInstance) => {
  fastify.post("/", createGroupChat);
  fastify.patch("/permissions", updateGroupPermissions);
  fastify.post("/:conversationId/add-users", addUsersToGroup);
  fastify.delete("/:conversationId/remove-users", removeUsersFromGroup); //able to only grup admin
};

export default grupRoutes;
