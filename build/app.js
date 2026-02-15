"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fastify_1 = __importDefault(require("fastify"));
const autoload_1 = __importDefault(require("@fastify/autoload"));
const cors_1 = __importDefault(require("@fastify/cors"));
const v1_1 = __importDefault(require("./src/routes/v1"));
const static_1 = __importDefault(require("@fastify/static"));
const storage_config_1 = require("./src/config/storage.config");
const app = (0, fastify_1.default)({ logger: true });
app.register(cors_1.default, {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});
(0, storage_config_1.registerMultipart)(app);
app.register(autoload_1.default, {
    dir: path_1.default.join(__dirname, "src/plugins"),
});
app.register(v1_1.default, { prefix: "/api/v1" });
app.register(static_1.default, {
    root: path_1.default.join(__dirname, "uploads"),
    prefix: "/uploads/",
});
app.setNotFoundHandler((request, reply) => {
    reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Route not found",
    });
});
app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const message = error instanceof Error ? error.message : String(error);
    reply.status(500).send({
        statusCode: 500,
        error: message,
        message: "Internal Server Error",
    });
});
exports.default = app;
//# sourceMappingURL=app.js.map