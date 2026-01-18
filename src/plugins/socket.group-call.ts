import { Server } from "socket.io";
import { saveCallHistory, updateCallHistory } from "../utils/callHistory";
import { FileService } from "../utils/fileService";
import { getJsonArray } from "../utils/jsonArray";

// Store active group calls: conversationId -> call data
const activeGroupCalls = new Map<string, {
  conversationId: string;
  callId: string;
  creatorId: string;
  callType: "audio" | "video";
  participants: Set<string>;
}>();

export const setupGroupCallHandlers = (
  io: Server,
  socket: any,
  fastify: any,
  helpers: {
    getUserIdBySocket: (socketId: string) => string | null;
    getSocketsForUser: (userId: string) => Set<string> | undefined;
  }
) => {
  const { getUserIdBySocket, getSocketsForUser: getSocketsForUserHelper } = helpers;

  const getUserId = () => getUserIdBySocket(socket.id);
  const getSocketsForUser = (userId: string) => getSocketsForUserHelper(userId);

  // 1. Create Group Call - OPTIMIZED
  socket.on("group_call_initiate", async (data: {
    conversationId: string;
    userId: string;
    callType: "audio" | "video";
  }) => {
    const { conversationId, userId, callType } = data;

    if (!conversationId || !userId) {
      socket.emit("group_call_failed", { message: "Missing conversationId or userId" });
      return;
    }

    // Check if group call already exists
    if (activeGroupCalls.has(conversationId)) {
      socket.emit("group_call_busy", { message: "Group call already active" });
      return;
    }

    try {
      // Get all conversation members in one query (optimized)
      const members = await fastify.prisma.conversationMember.findMany({
        where: { conversationId, isDeleted: false },
        include: {
          user: {
            select: { id: true, name: true, avatar: true, fcmToken: true },
          },
        },
      });

      if (members.length === 0) {
        socket.emit("group_call_failed", { message: "No members found" });
        return;
      }

      // Find creator info quickly
      const creatorMember = members.find(m => m.userId === parseInt(userId));
      const creatorInfo = creatorMember?.user || {
        id: parseInt(userId),
        name: `User ${userId}`,
        avatar: null,
      };

      // Prepare call data once (before any async operations)
      const callData = {
        conversationId,
        callType,
        creatorInfo: {
          ...creatorInfo,
          avatar: FileService.avatarUrl(creatorInfo.avatar || ""),
        },
      };

      // EMIT CALL NOTIFICATIONS IMMEDIATELY (BEFORE DATABASE OPERATIONS)
      for (const member of members) {
        if (!member.user || member.userId === parseInt(userId)) continue;
        const memberUserId = member.userId.toString();
        // Emit immediately to userId room (socket joins userId room on connect)
        io.to(memberUserId).emit("group_call_incoming", callData);
      }

      // Store active call in memory (instant)
      const tempCallId = `temp-${Date.now()}`;
      activeGroupCalls.set(conversationId, {
        conversationId,
        callId: tempCallId,
        creatorId: userId,
        callType,
        participants: new Set([userId]),
      });

      // Confirm to creator immediately (don't wait for database)
      socket.emit("group_call_created", {
        conversationId,
        callId: tempCallId,
        callType,
        participants: [{ id: parseInt(userId), name: creatorInfo.name, avatar: creatorInfo.avatar }],
      });

      // Save call history in background (non-blocking)
      saveCallHistory(fastify.prisma, {
        callerId: parseInt(userId),
        receiverId: parseInt(userId),
        type: callType.toUpperCase() as "AUDIO" | "VIDEO",
        status: "ONGOING",
        conversationId,
        startedAt: new Date(),
      }).then((callId) => {
        // Update callId in memory if we got one
        const groupCall = activeGroupCalls.get(conversationId);
        if (groupCall && callId) {
          groupCall.callId = callId;
        }
      }).catch(() => {
        // If call history fails, continue anyway
      });

      // Fire push notifications in background (non-blocking)
      const pushData = {
        type: "group_call_initiate",
        success: "true",
        message: "Incoming group call",
        data: JSON.stringify(callData),
      };

      for (const member of members) {
        if (!member.user || member.userId === parseInt(userId)) continue;
        const fcmTokens = getJsonArray<string>(member.user.fcmToken, []);
        fcmTokens.forEach(token => {
          if (token) {
            fastify.sendDataPush(token, pushData).catch(() => {});
          }
        });
      }

    } catch (error: any) {
      console.error("[GROUP_CALL_INITIATE] Error:", error);
      socket.emit("group_call_failed", { message: "Failed to create group call" });
    }
  });

  // 2. Join Group Call - OPTIMIZED
  socket.on("group_call_join", async (data: {
    conversationId: string;
    userId: string;
  }) => {
    const { conversationId, userId } = data;

    if (!conversationId || !userId) {
      return;
    }

    const groupCall = activeGroupCalls.get(conversationId);
    if (!groupCall) {
      socket.emit("group_call_not_found", { conversationId });
      return;
    }

    // Add user to participants
    groupCall.participants.add(userId);

    // Get user info quickly (only for notifications)
    let userInfo = null;
    try {
      const user = await fastify.prisma.user.findUnique({
        where: { id: parseInt(userId) },
        select: { id: true, name: true, avatar: true },
      });
      if (user) {
        userInfo = {
          ...user,
          avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
        };
      }
    } catch {
      userInfo = { id: parseInt(userId), name: `User ${userId}`, avatar: null };
    }

    // Notify all participants (fast - no database)
    const notifyData = {
      conversationId,
      userId,
      userInfo: userInfo || { id: parseInt(userId), name: `User ${userId}`, avatar: null },
    };

    const notifyPromises: Promise<any>[] = [];
    for (const participantId of groupCall.participants) {
      if (participantId === userId) continue;
      const participantSockets = getSocketsForUser(participantId);
      if (participantSockets && participantSockets.size > 0) {
        // Emit to userId room
        io.to(participantId).emit("group_call_member_joined", notifyData);
      }
    }

    // Confirm to joiner with simple participant list
    const participantIds = Array.from(groupCall.participants).map(id => ({
      id: parseInt(id),
      name: `User ${id}`,
      avatar: null,
    }));

    socket.emit("group_call_joined", {
      conversationId,
      participants: participantIds,
    });

    // Fire notifications without blocking
    if (notifyPromises.length > 0) {
      Promise.allSettled(notifyPromises).catch(() => {});
    }
  });

  // 3. Leave Group Call - OPTIMIZED
  socket.on("group_call_leave", async (data: {
    conversationId: string;
    userId: string;
  }) => {
    const { conversationId, userId } = data;

    if (!conversationId || !userId) return;

    const groupCall = activeGroupCalls.get(conversationId);
    if (!groupCall || !groupCall.participants.has(userId)) return;

    groupCall.participants.delete(userId);

    // Notify participants (fast)
    const notifyData = { conversationId, userId };
    for (const participantId of groupCall.participants) {
      const participantSockets = getSocketsForUser(participantId);
      if (participantSockets && participantSockets.size > 0) {
        io.to(participantId).emit("group_call_member_left", notifyData);
      }
    }

    // End call if empty
    if (groupCall.participants.size === 0) {
      updateCallHistory(fastify.prisma, groupCall.callId, "COMPLETED", new Date()).catch(() => {});
      activeGroupCalls.delete(conversationId);
    }

    socket.emit("group_call_left", { conversationId });
  });

  // 4. End Group Call - OPTIMIZED
  socket.on("group_call_end", async (data: {
    conversationId: string;
    userId: string;
  }) => {
    const { conversationId, userId } = data;

    if (!conversationId || !userId) return;

    const groupCall = activeGroupCalls.get(conversationId);
    if (!groupCall || !groupCall.participants.has(userId)) {
      socket.emit("group_call_failed", { message: "You are not in this call" });
      return;
    }

    // Update call history (async)
    updateCallHistory(fastify.prisma, groupCall.callId, "COMPLETED", new Date()).catch(() => {});

    // Notify all participants (fast)
    const notifyData = { conversationId, endedBy: userId };
    for (const participantId of groupCall.participants) {
      const participantSockets = getSocketsForUser(participantId);
      if (participantSockets && participantSockets.size > 0) {
        io.to(participantId).emit("group_call_ended", notifyData);
      }
    }

    activeGroupCalls.delete(conversationId);
    socket.emit("group_call_ended_confirm", { conversationId });
  });

  // 5. Decline Group Call - OPTIMIZED
  socket.on("group_call_decline", async (data: {
    conversationId: string;
    userId: string;
  }) => {
    const { conversationId, userId } = data;

    if (!conversationId || !userId) return;

    const groupCall = activeGroupCalls.get(conversationId);
    if (!groupCall) return;

    groupCall.participants.delete(userId);

    // Notify creator (fast)
    const creatorSockets = getSocketsForUser(groupCall.creatorId);
    if (creatorSockets && creatorSockets.size > 0) {
      io.to(groupCall.creatorId).emit("group_call_declined", { conversationId, userId });
    }

    socket.emit("group_call_declined_confirm", { conversationId });
  });

  // 6. WebRTC Offer for Group Call
  socket.on("group_call_webrtc_offer", (data: {
    conversationId: string;
    receiverId: string;
    sdp: RTCSessionDescriptionInit;
  }) => {
    const senderId = getUserId();
    if (!senderId || !data.receiverId || !data.conversationId) return;

    const groupCall = activeGroupCalls.get(data.conversationId);
    if (!groupCall || !groupCall.participants.has(senderId) || !groupCall.participants.has(data.receiverId)) {
      return;
    }

    const receiverSockets = getSocketsForUser(data.receiverId);
    if (receiverSockets && receiverSockets.size > 0) {
      io.to(data.receiverId).emit("group_call_webrtc_offer", {
        senderId,
        conversationId: data.conversationId,
        sdp: data.sdp,
      });
    }
  });

  // 7. WebRTC Answer for Group Call
  socket.on("group_call_webrtc_answer", (data: {
    conversationId: string;
    senderId: string;
    sdp: RTCSessionDescriptionInit;
  }) => {
    const receiverId = getUserId();
    if (!receiverId || !data.senderId || !data.conversationId) return;

    const groupCall = activeGroupCalls.get(data.conversationId);
    if (!groupCall || !groupCall.participants.has(receiverId) || !groupCall.participants.has(data.senderId)) {
      return;
    }

    const senderSockets = getSocketsForUser(data.senderId);
    if (senderSockets && senderSockets.size > 0) {
      io.to(data.senderId).emit("group_call_webrtc_answer", {
        receiverId,
        conversationId: data.conversationId,
        sdp: data.sdp,
      });
    }
  });

  // 8. ICE Candidate for Group Call
  socket.on("group_call_webrtc_ice", (data: {
    conversationId: string;
    receiverId: string;
    candidate: RTCIceCandidate;
  }) => {
    const senderId = getUserId();
    if (!senderId || !data.receiverId || !data.conversationId) return;

    const groupCall = activeGroupCalls.get(data.conversationId);
    if (!groupCall || !groupCall.participants.has(senderId) || !groupCall.participants.has(data.receiverId)) {
      return;
    }

    const receiverSockets = getSocketsForUser(data.receiverId);
    if (receiverSockets && receiverSockets.size > 0) {
      io.to(data.receiverId).emit("group_call_webrtc_ice", {
        senderId,
        conversationId: data.conversationId,
        candidate: data.candidate,
      });
    }
  });

  // Return cleanup function
  return {
    cleanupGroupCallsOnDisconnect: () => {
      const userId = getUserId();
      if (!userId) return;

      for (const [conversationId, groupCall] of activeGroupCalls.entries()) {
        if (groupCall.participants.has(userId)) {
          groupCall.participants.delete(userId);

          // Notify other participants (fast)
          for (const participantId of groupCall.participants) {
            const participantSockets = getSocketsForUser(participantId);
            if (participantSockets && participantSockets.size > 0) {
              io.to(participantId).emit("group_call_member_left", { conversationId, userId });
            }
          }

          // End call if empty
          if (groupCall.participants.size === 0) {
            updateCallHistory(fastify.prisma, groupCall.callId, "COMPLETED", new Date()).catch(() => {});
            activeGroupCalls.delete(conversationId);
          }
        }
      }
    },
  };
};
