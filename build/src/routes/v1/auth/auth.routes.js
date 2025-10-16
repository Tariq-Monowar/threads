"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_controllers_1 = require("./auth.controllers");
const authRoutes = (fastify) => {
    fastify.post("/set-user", auth_controllers_1.registerUser);
};
exports.default = authRoutes;
//# sourceMappingURL=auth.routes.js.map