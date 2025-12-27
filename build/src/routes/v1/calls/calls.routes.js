"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const calls_controllers_1 = require("./calls.controllers");
const callRoutes = (fastify) => {
    fastify.get("/history/:userId", calls_controllers_1.getCallHistory);
    fastify.get("/:callId", calls_controllers_1.getCallDetails);
    fastify.delete("/delete-call", calls_controllers_1.deleteCall);
};
exports.default = callRoutes;
//# sourceMappingURL=calls.routes.js.map