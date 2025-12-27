"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const conversation_controllers_1 = require("./conversation.controllers");
const archive_routes_1 = __importDefault(require("./archive/archive.routes"));
const mute_routes_1 = __importDefault(require("./mute/mute.routes"));
const privateRoutes = (fastify) => {
    fastify.get("/list/:myId", conversation_controllers_1.getMyConversationsList);
    fastify.get("/:conversationId", conversation_controllers_1.getSingleConversation);
    fastify.register(archive_routes_1.default, { prefix: "/archive" });
    fastify.register(mute_routes_1.default, { prefix: "/mute" });
};
exports.default = privateRoutes;
//# sourceMappingURL=conversation.routes.js.map