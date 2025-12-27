"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const auth_routes_1 = __importDefault(require("./auth/auth.routes"));
const conversation_routes_1 = __importDefault(require("./conversation/conversation.routes"));
const messages_routes_1 = __importDefault(require("./messages/messages.routes"));
const calls_routes_1 = __importDefault(require("./calls/calls.routes"));
const block_routes_1 = __importDefault(require("./block/block.routes"));
const private_routes_1 = __importDefault(require("./conversation/private/private.routes"));
const group_routes_1 = __importDefault(require("./conversation/group/group.routes"));
async function routesV1(fastify) {
    const moduleRoutes = [
        { path: "/auth", route: auth_routes_1.default },
        { path: "/conversation", route: conversation_routes_1.default },
        { path: "/messages", route: messages_routes_1.default },
        { path: "/calls", route: calls_routes_1.default },
        { path: "/block", route: block_routes_1.default },
        { path: "/conversation/groups", route: group_routes_1.default },
        { path: "/conversation/private", route: private_routes_1.default },
    ];
    moduleRoutes.forEach(({ path, route }) => {
        fastify.register(route, { prefix: path });
    });
}
exports.default = routesV1;
//# sourceMappingURL=index.js.map