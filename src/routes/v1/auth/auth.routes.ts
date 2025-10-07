import { FastifyInstance } from "fastify";
import {
  test,
} from "./auth.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const authRoutes = (fastify: FastifyInstance) => {

  fastify.post("/test", test);

};

export default authRoutes;
