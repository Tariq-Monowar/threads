"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const private_controllers_1 = require("./private.controllers");
const conversationRoutes = (fastify) => {
    fastify.post("/create", private_controllers_1.createConversation);
    fastify.delete("/:conversationId/delete-for-me", private_controllers_1.deleteConversationForMe);
    //i need to get convercation using user id
    fastify.post("/get", private_controllers_1.getConversationsByUserId);
};
exports.default = conversationRoutes;
//# sourceMappingURL=private.routes.js.map