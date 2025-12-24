import { FastifyInstance } from "fastify";
import { addArchived, removeArchived, getMyArchiveConversationsList } from "./archive.controllers";

const archiveRoutes = (fastify: FastifyInstance) => {
  fastify.post("/add", addArchived);
  fastify.post("/remove", removeArchived);
  fastify.get("/list/:myId", getMyArchiveConversationsList);
};

export default archiveRoutes;

