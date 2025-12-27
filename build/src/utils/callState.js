"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCallState = void 0;
const createCallState = () => {
    const activeCalls = new Map();
    const callHistoryMap = new Map();
    const iceCandidateBuffers = new Map();
    const getIceCandidateBuffer = (userId, peerId) => {
        const key = `${userId}-${peerId}`;
        if (!iceCandidateBuffers.has(key)) {
            iceCandidateBuffers.set(key, []);
        }
        return iceCandidateBuffers.get(key);
    };
    const clearIceCandidateBuffer = (userId, peerId) => {
        const key = `${userId}-${peerId}`;
        iceCandidateBuffers.delete(key);
        const reverseKey = `${peerId}-${userId}`;
        iceCandidateBuffers.delete(reverseKey);
    };
    const setCallHistoryForPair = (callerId, receiverId, callId) => {
        callHistoryMap.set(`${callerId}-${receiverId}`, callId);
        callHistoryMap.set(`${receiverId}-${callerId}`, callId);
    };
    const getCallHistoryForPair = (callerId, receiverId) => callHistoryMap.get(`${callerId}-${receiverId}`);
    const clearCallHistoryForPair = (callerId, receiverId) => {
        callHistoryMap.delete(`${callerId}-${receiverId}`);
        callHistoryMap.delete(`${receiverId}-${callerId}`);
    };
    return {
        activeCalls,
        callHistoryMap,
        iceCandidateBuffers,
        getIceCandidateBuffer,
        clearIceCandidateBuffer,
        setCallHistoryForPair,
        getCallHistoryForPair,
        clearCallHistoryForPair,
    };
};
exports.createCallState = createCallState;
//# sourceMappingURL=callState.js.map