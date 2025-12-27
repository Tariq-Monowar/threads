"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const archive_controllers_1 = require("./archive.controllers");
const archiveRoutes = (fastify) => {
    fastify.post("/add", archive_controllers_1.addArchived);
    fastify.post("/remove", archive_controllers_1.removeArchived);
    fastify.get("/list/:myId", archive_controllers_1.getMyArchiveConversationsList);
};
exports.default = archiveRoutes;
//# sourceMappingURL=archive.routes.js.map