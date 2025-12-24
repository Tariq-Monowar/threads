export const addMute = async (request, reply) => {
  try {
    const { myId, conversationIds } = request.body;
    const prisma = request.server.prisma;

    if (!myId || !conversationIds || !Array.isArray(conversationIds)) {
      return reply.status(400).send({
        success: false,
        message: "myId and conversationIds (array) are required!",
      });
    }

    const userIdInt = parseInt(myId);
    if (isNaN(userIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid myId provided!",
      });
    }

    if (conversationIds.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "conversationIds array cannot be empty!",
      });
    }

    // Update conversations to muted
    const result = await prisma.conversationMember.updateMany({
      where: {
        userId: userIdInt,
        conversationId: { in: conversationIds },
        isDeleted: false,
      },
      data: {
        isMute: true,
        muteAt: new Date(),
      },
    });

    return reply.send({
      success: true,
      message: `${result.count} conversation(s) muted successfully`,
      data: {
        myId: userIdInt,
        conversationIds,
        mutedCount: result.count,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to mute conversations",
    });
  }
};

export const removeMute = async (request, reply) => {
  try {
    const { myId, conversationIds } = request.body;
    const prisma = request.server.prisma;

    if (!myId || !conversationIds || !Array.isArray(conversationIds)) {
      return reply.status(400).send({
        success: false,
        message: "myId and conversationIds (array) are required!",
      });
    }

    const userIdInt = parseInt(myId);
    if (isNaN(userIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid myId provided!",
      });
    }

    if (conversationIds.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "conversationIds array cannot be empty!",
      });
    }

    // Remove mute status
    const result = await prisma.conversationMember.updateMany({
      where: {
        userId: userIdInt,
        conversationId: { in: conversationIds },
        isDeleted: false,
      },
      data: {
        isMute: false,
        muteAt: null,
      },
    });

    return reply.send({
      success: true,
      message: `${result.count} conversation(s) unmuted successfully`,
      data: {
        myId: userIdInt,
        conversationIds,
        unmutedCount: result.count,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to unmute conversations",
    });
  }
};

