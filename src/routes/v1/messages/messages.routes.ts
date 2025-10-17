import { FastifyInstance } from "fastify";
import { createChatRoom } from "./messages.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const authRoutes = (fastify: FastifyInstance) => {
  fastify.post("/create-chat-room", createChatRoom);

};

export default authRoutes;
