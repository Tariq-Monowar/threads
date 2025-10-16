import { FastifyInstance } from "fastify";
import { registerUser, updateUser } from "./auth.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const authRoutes = (fastify: FastifyInstance) => {
  fastify.post("/set-user", registerUser);
  fastify.patch("/update-user/:id", updateUser);
};

export default authRoutes;
