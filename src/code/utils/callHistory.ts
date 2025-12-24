import { PrismaClient } from "@prisma/client";

export type CallHistoryType = "AUDIO" | "VIDEO";
export type CallHistoryStatus =
  | "ONGOING"
  | "COMPLETED"
  | "MISSED"
  | "DECLINED"
  | "CANCELED";

export const saveCallHistory = async (
  prisma: PrismaClient | undefined,
  params: {
    callerId: number;
    receiverId: number;
    type: CallHistoryType;
    status: CallHistoryStatus;
    conversationId?: string;
    startedAt?: Date;
    endedAt?: Date;
  }
): Promise<string | null> => {
  if (!prisma) {
    return null;
  }

  const { callerId, receiverId, type, status, conversationId, startedAt, endedAt } =
    params;

  const callData: any = {
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
    const call = await (prisma as any).call.create({
      data: callData,
    });
    return call?.id ?? null;
  } catch {
    return null;
  }
};

export const updateCallHistory = async (
  prisma: PrismaClient | undefined,
  callId: string,
  status: CallHistoryStatus,
  endedAt?: Date
): Promise<void> => {
  if (!prisma) {
    return;
  }

  const updateData: any = { status };
  if (endedAt) {
    updateData.endedAt = endedAt;
  }

  try {
    await (prisma as any).call.update({
      where: { id: callId },
      data: updateData,
    });
  } catch {
    // swallow errors per existing behavior
  }
};

