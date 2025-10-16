"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const auth_routes_1 = __importDefault(require("./auth/auth.routes"));
async function routesV1(fastify) {
    const moduleRoutes = [
        { path: "/auth", route: auth_routes_1.default },
    ];
    moduleRoutes.forEach(({ path, route }) => {
        fastify.register(route, { prefix: path });
    });
}
exports.default = routesV1;
//# sourceMappingURL=index.js.map