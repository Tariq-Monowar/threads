"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_controllers_1 = require("./auth.controllers");
const authRoutes = (fastify) => {
    fastify.post("/set-user", auth_controllers_1.registerUser);
    fastify.patch("/update-user/:id", auth_controllers_1.updateUser);
};
exports.default = authRoutes;
//# sourceMappingURL=auth.routes.js.map