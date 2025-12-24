import { FastifyInstance } from "fastify";
import { getMyConversationsList, getSingleConversation } from "./conversation.controllers";
import archiveRoutes from "./archive/archive.routes";
import muteRoutes from "./mute/mute.routes";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const privateRoutes = (fastify: FastifyInstance) => {
  fastify.get("/list/:myId", getMyConversationsList);
  fastify.get("/:conversationId", getSingleConversation);
  fastify.register(archiveRoutes, { prefix: "/archive" });
  fastify.register(muteRoutes, { prefix: "/mute" });
};

export default privateRoutes;
