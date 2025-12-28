import { FastifyInstance } from "fastify";
import {
  registerUser,
  updateUser,
  getAllUsers,
  deleteUser,
  myinfo,
  searchUsers,
  syncUsers,
  setFcmToken,
  removeFcmToken,
  removeAllFcm,
  testFCMToken,
  testFirebase
} from "./auth.controllers";
import { upload } from "../../../config/storage.config";
import { verifyUser } from "../../../middleware/auth.middleware";

const authRoutes = (fastify: FastifyInstance) => {
  fastify.get("/me/:myId", myinfo);
  fastify.post("/set-user", registerUser);
  fastify.patch("/update-user/:id", updateUser);
  fastify.get("/get-users", getAllUsers);
  fastify.delete("/delete-user/:id", deleteUser);
  fastify.get("/search-users/:myId", searchUsers);
  fastify.post("/search-users/load-data", syncUsers);

  fastify.post("/set-fcm-token/:myId", setFcmToken);
  fastify.post("/remove-fcm-token/:myId", removeFcmToken);

  fastify.post("/remove", removeAllFcm);
  fastify.post("/send-notification/:myId?", testFCMToken);
  fastify.post("/test-firebase", testFirebase);
};

export default authRoutes;
