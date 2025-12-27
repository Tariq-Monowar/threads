"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCallHistory = exports.saveCallHistory = void 0;
const saveCallHistory = async (prisma, params) => {
    if (!prisma) {
        return null;
    }
    const { callerId, receiverId, type, status, conversationId, startedAt, endedAt } = params;
    const callData = {
        callerId,
        receiverId,
        type,
        status,
        participantIds: [],
    };
    if (conversationId) {
        callData.conversationId = conversationId;
    }
    if (startedAt) {
        callData.startedAt = startedAt;
    }
    if (endedAt) {
        callData.endedAt = endedAt;
    }
    try {
        const call = await prisma.call.create({
            data: callData,
        });
        return call?.id ?? null;
    }
    catch {
        return null;
    }
};
exports.saveCallHistory = saveCallHistory;
const updateCallHistory = async (prisma, callId, status, endedAt) => {
    if (!prisma) {
        return;
    }
    const updateData = { status };
    if (endedAt) {
        updateData.endedAt = endedAt;
    }
    try {
        await prisma.call.update({
            where: { id: callId },
            data: updateData,
        });
    }
    catch {
        // swallow errors per existing behavior
    }
};
exports.updateCallHistory = updateCallHistory;
//# sourceMappingURL=callHistory.js.map