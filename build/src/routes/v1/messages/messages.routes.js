"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const messages_controllers_1 = require("./messages.controllers");
const storage_config_1 = require("../../../config/storage.config");
const messageRoutes = (fastify) => {
    fastify.post("/send", { preHandler: storage_config_1.upload.array("files") }, messages_controllers_1.sendMessage);
    fastify.get("/get-messages/:conversationId", messages_controllers_1.getMessages);
    fastify.delete("/messages/:messageId", messages_controllers_1.deleteMessage);
    fastify.delete("/delete-for-me/:messageId", messages_controllers_1.deleteMessageForMe);
    fastify.delete("/delete-for-everyone/:messageId", messages_controllers_1.deleteMessageForEveryone);
    fastify.patch("/mark-as-read/:conversationId", messages_controllers_1.markMultipleMessagesAsRead);
    fastify.patch("/messages/:messageId", { preHandler: storage_config_1.upload.array("files") }, messages_controllers_1.updateMessage);
    fastify.patch("/delivered/:conversationId", messages_controllers_1.markMessageAsDelivered);
};
exports.default = messageRoutes;
//# sourceMappingURL=messages.routes.js.map