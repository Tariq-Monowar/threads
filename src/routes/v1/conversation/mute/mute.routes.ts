import { FastifyInstance } from "fastify";
import { addMute, removeMute } from "./mute.controllers";

const muteRoutes = (fastify: FastifyInstance) => {
  fastify.post("/add", addMute);
  fastify.post("/remove", removeMute);
};

export default muteRoutes;

