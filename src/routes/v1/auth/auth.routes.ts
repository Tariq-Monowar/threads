import { FastifyInstance } from "fastify";
import { registerUser, updateUser, getAllUsers, deleteUser, myinfo } from "./auth.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const authRoutes = (fastify: FastifyInstance) => {
  fastify.get("/me/:myId", myinfo);
  fastify.post("/set-user", registerUser);
  fastify.patch("/update-user/:id", updateUser);
  fastify.get("/get-users", getAllUsers);
  fastify.delete("/delete-user/:id", deleteUser);

};

export default authRoutes;
