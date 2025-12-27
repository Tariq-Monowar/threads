"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_controllers_1 = require("./auth.controllers");
const authRoutes = (fastify) => {
    fastify.get("/me/:myId", auth_controllers_1.myinfo);
    fastify.post("/set-user", auth_controllers_1.registerUser);
    fastify.patch("/update-user/:id", auth_controllers_1.updateUser);
    fastify.get("/get-users", auth_controllers_1.getAllUsers);
    fastify.delete("/delete-user/:id", auth_controllers_1.deleteUser);
    fastify.get("/search-users/:myId", auth_controllers_1.searchUsers);
    fastify.post("/search-users/load-data", auth_controllers_1.syncUsers);
    fastify.post("/set-fcm-token/:myId", auth_controllers_1.setFcmToken);
    fastify.post("/remove-fcm-token/:myId", auth_controllers_1.removeFcmToken);
    fastify.post("/remove", auth_controllers_1.removeAllFcm);
};
exports.default = authRoutes;
//# sourceMappingURL=auth.routes.js.map