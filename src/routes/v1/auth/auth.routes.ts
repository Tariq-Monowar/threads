import { FastifyInstance } from "fastify";
import { registerUser } from "./auth.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const authRoutes = (fastify: FastifyInstance) => {
  fastify.post("/set-user", registerUser);
};

export default authRoutes;
