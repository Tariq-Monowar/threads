"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const storage_config_1 = require("../config/storage.config");
class FileService {
    static isUrl(maybeUrl) {
        return /^https?:\/\//i.test(maybeUrl);
    }
    static normalizeToDiskPath(input) {
        if (!input || typeof input !== "string")
            return undefined;
        if (this.isUrl(input))
            return undefined;
        let filename = input.replace(/^[/\\]?uploads[/\\]/i, "");
        filename = filename.replace(/^[/\\]+/, "");
        if (!filename)
            return undefined;
        return path_1.default.join(storage_config_1.uploadsDir, filename);
    }
    static removeFile(filenameOrUrl) {
        const absPath = this.normalizeToDiskPath(filenameOrUrl);
        if (!absPath)
            return;
        try {
            if (fs_1.default.existsSync(absPath)) {
                fs_1.default.unlinkSync(absPath);
            }
        }
        catch (_) { }
    }
    static removeFiles(filenamesOrUrls) {
        filenamesOrUrls.forEach((f) => this.removeFile(f));
    }
    static removeFileByPath(filePath) {
        try {
            if (fs_1.default.existsSync(filePath)) {
                fs_1.default.unlinkSync(filePath);
            }
        }
        catch (_) { }
    }
    static avatarUrl(avatar) {
        return `https://deficall.defilinkteam.org/${avatar}`;
    }
}
exports.FileService = FileService;
//# sourceMappingURL=fileService.js.map