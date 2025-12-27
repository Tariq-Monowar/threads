"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const block_controllers_1 = require("./block.controllers");
const blockRoutes = (fastify) => {
    fastify.post("/add", block_controllers_1.blockUser);
    fastify.post("/remove", block_controllers_1.unblockUser);
    fastify.get("/list/:myId", block_controllers_1.getBlockList);
};
exports.default = blockRoutes;
//# sourceMappingURL=block.routes.js.map