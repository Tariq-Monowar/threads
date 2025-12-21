"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMultipart = exports.upload = exports.uploadsDir = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const fastify_multer_1 = __importDefault(require("fastify-multer"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
exports.uploadsDir = path_1.default.join(__dirname, "../../uploads");
if (!fs_1.default.existsSync(exports.uploadsDir)) {
    fs_1.default.mkdirSync(exports.uploadsDir, { recursive: true });
}
const storage = fastify_multer_1.default.diskStorage({
    destination: (req, file, cb) => cb(null, exports.uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = (0, uuid_1.v4)();
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    },
});
exports.upload = (0, fastify_multer_1.default)({
    storage,
    fileFilter: (req, file, cb) => {
        // Accept all file types
        cb(null, true);
    },
    limits: {
        fileSize: Infinity, // No file size limit
    }
});
const registerMultipart = (fastify) => {
    fastify.register(multipart_1.default, {
        limits: {
            fileSize: Infinity, // No file size limit
            files: Infinity, // No limit on number of files
            fields: Infinity, // No limit on number of fields
            parts: Infinity // No limit on total parts
        }
    });
};
exports.registerMultipart = registerMultipart;
//# sourceMappingURL=storage.config.js.map