"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformMessage = transformMessage;
const baseurl_1 = require("./baseurl");
const fileService_1 = require("./fileService");
function transformMessage(message, participantIds) {
    const clone = { ...message };
    if ("deletedForUsers" in clone) {
        delete clone.deletedForUsers;
    }
    const senderId = typeof clone.userId === "number" ? clone.userId : null;
    const receiverId = participantIds.filter((id) => id !== senderId);
    return {
        ...clone,
        senderId,
        receiverId,
        user: clone.user
            ? {
                ...clone.user,
                avatar: clone.user.avatar
                    ? fileService_1.FileService.avatarUrl(clone.user.avatar)
                    : null,
            }
            : clone.user,
        MessageFile: (clone.MessageFile || []).map((f) => ({
            ...f,
            fileUrl: f?.fileUrl ? (0, baseurl_1.getImageUrl)(f.fileUrl) : f.fileUrl,
        })),
    };
}
//# sourceMappingURL=message.utils.js.map