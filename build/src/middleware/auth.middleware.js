"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyUser = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const verifyUser = (...allowedRoles) => {
    return async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader) {
            reply.status(401).send({
                success: false,
                message: "No token provided",
            });
            return;
        }
        try {
            const token = authHeader;
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            request.user = decoded;
            if (allowedRoles.length &&
                !allowedRoles.includes("ANY") &&
                !allowedRoles.includes(request.user?.type)) {
                reply.status(403).send({
                    success: false,
                    message: "Access denied! you have no permission to access this resource",
                });
                return;
            }
        }
        catch (error) {
            reply.status(401).send({
                success: false,
                message: "Invalid or expired token",
            });
            return;
        }
    };
};
exports.verifyUser = verifyUser;
//# sourceMappingURL=auth.middleware.js.map