export type CallType = "audio" | "video";
export type CallStatus = "calling" | "in_call";

export interface CallData {
  with: string;
  status: CallStatus;
  type: CallType;
}

export interface ICECandidateBuffer {
  candidate: RTCIceCandidate;
  timestamp: number;
}

export const createCallState = () => {
  const activeCalls = new Map<string, CallData>();
  const callHistoryMap = new Map<string, string>();
  const iceCandidateBuffers = new Map<string, ICECandidateBuffer[]>();

  const getIceCandidateBuffer = (
    userId: string,
    peerId: string
  ): ICECandidateBuffer[] => {
    const key = `${userId}-${peerId}`;
    if (!iceCandidateBuffers.has(key)) {
      iceCandidateBuffers.set(key, []);
    }
    return iceCandidateBuffers.get(key)!;
  };

  const clearIceCandidateBuffer = (userId: string, peerId: string) => {
    const key = `${userId}-${peerId}`;
    iceCandidateBuffers.delete(key);
    const reverseKey = `${peerId}-${userId}`;
    iceCandidateBuffers.delete(reverseKey);
  };

  const setCallHistoryForPair = (
    callerId: string,
    receiverId: string,
    callId: string
  ) => {
    callHistoryMap.set(`${callerId}-${receiverId}`, callId);
    callHistoryMap.set(`${receiverId}-${callerId}`, callId);
  };

  const getCallHistoryForPair = (
    callerId: string,
    receiverId: string
  ): string | undefined => callHistoryMap.get(`${callerId}-${receiverId}`);

  const clearCallHistoryForPair = (callerId: string, receiverId: string) => {
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

