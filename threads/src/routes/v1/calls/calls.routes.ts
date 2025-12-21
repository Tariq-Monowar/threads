import { FastifyInstance } from "fastify";
import {
  getCallHistory,
  getCallDetails,
  deleteCall,
} from "./calls.controllers";

const callRoutes = (fastify: FastifyInstance) => {
  fastify.get("/history/:userId", getCallHistory);
  fastify.get("/:callId", getCallDetails);
  fastify.delete("/delete-call", deleteCall);
};

export default callRoutes;
