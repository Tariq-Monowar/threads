"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mute_controllers_1 = require("./mute.controllers");
const muteRoutes = (fastify) => {
    fastify.post("/add", mute_controllers_1.addMute);
    fastify.post("/remove", mute_controllers_1.removeMute);
};
exports.default = muteRoutes;
//# sourceMappingURL=mute.routes.js.map