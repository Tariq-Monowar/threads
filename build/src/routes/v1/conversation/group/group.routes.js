"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const group_controllers_1 = require("./group.controllers");
const storage_config_1 = require("../../../../config/storage.config");
const groupRoutes = (fastify) => {
    fastify.post("/", { preHandler: storage_config_1.upload.single("avatar") }, group_controllers_1.createGroupChat);
    fastify.patch("/permissions", group_controllers_1.updateGroupPermissions);
    fastify.patch("/:conversationId/info", { preHandler: storage_config_1.upload.single("avatar") }, group_controllers_1.updateGroupInfo);
    fastify.post("/:conversationId/add-users", group_controllers_1.addUsersToGroup);
    fastify.delete("/:conversationId/remove-users", group_controllers_1.removeUsersFromGroup);
    fastify.post("/:conversationId/leave", group_controllers_1.leaveFromGroup);
    fastify.post("/:conversationId/make-admin", group_controllers_1.makeGroupAdmin);
    fastify.post("/:conversationId/remove-admin", group_controllers_1.removeGroupAdmin);
    fastify.delete("/:conversationId/destroy", group_controllers_1.destroyGroup);
    // fastify.get("/:conversationId/members", getGroupMembers);
};
exports.default = groupRoutes;
//# sourceMappingURL=group.routes.js.map