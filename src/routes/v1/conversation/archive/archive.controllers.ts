import { FileService } from "../../../../utils/fileService";
import { transformMessage } from "../../../../utils/message.utils";
import { getImageUrl } from "../../../../utils/baseurl";

export const addArchived = async (request, reply) => {
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

    // Update conversations to archived
    const result = await prisma.conversationMember.updateMany({
      where: {
        userId: userIdInt,
        conversationId: { in: conversationIds },
        isDeleted: false,
      },
      data: {
        isArchived: true,
        archivedAt: new Date(),
      },
    });

    return reply.send({
      success: true,
      message: `${result.count} conversation(s) archived successfully`,
      data: {
        myId: userIdInt,
        conversationIds,
        archivedCount: result.count,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to archive conversations",
    });
  }
};

export const removeArchived = async (request, reply) => {
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

    // Remove archived status
    const result = await prisma.conversationMember.updateMany({
      where: {
        userId: userIdInt,
        conversationId: { in: conversationIds },
        isDeleted: false,
      },
      data: {
        isArchived: false,
        archivedAt: null,
      },
    });

    return reply.send({
      success: true,
      message: `${result.count} conversation(s) unarchived successfully`,
      data: {
        myId: userIdInt,
        conversationIds,
        unarchivedCount: result.count,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      success: false,
      message: "Failed to unarchive conversations",
    });
  }
};

export const getMyArchiveConversationsList = async (request, reply) => {
  try {
    const { myId } = request.params;
    const prisma = request.server.prisma;

    const currentUserId = parseInt(myId);
    if (isNaN(currentUserId)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user ID provided!",
      });
    }

    const formatUserWithAvatar = (user) => {
      if (!user) return null;
      return {
        ...user,
        avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
      };
    };

    const processConversationMembers = (members, isGroup, currentUserId) => {
      const formattedMembers = members.map((member) => ({
        ...member,
        user: formatUserWithAvatar(member.user),
      }));

      if (!isGroup) {
        return formattedMembers.filter(
          (member) => member.userId !== currentUserId
        );
      }

      const [currentUserMembers, otherMembers] = formattedMembers.reduce(
        ([current, rest], member) =>
          member.userId === currentUserId
            ? [[...current, member], rest]
            : [current, [...rest, member]],
        [[], []]
      );

      return [...currentUserMembers, ...otherMembers].slice(0, 3);
    };

    const getParticipantIds = (members: any[]): number[] => {
      return members
        .map((member) => member.userId)
        .filter((id): id is number => typeof id === "number");
    };

    const batchCountUnreadMessages = async (
      prisma,
      conversationIds,
      currentUserId
    ) => {
      if (conversationIds.length === 0) return {};

      const unreadCounts = await prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversationIds },
          userId: { not: currentUserId },
          isRead: false,
          NOT: { deletedForUsers: { array_contains: currentUserId } },
        },
        _count: {
          id: true,
        },
      });

      const result: Record<string, number> = {};
      conversationIds.forEach((id) => {
        result[id] = 0;
      });

      unreadCounts.forEach((item: any) => {
        result[item.conversationId] = item._count.id;
      });

      return result;
    };

    const checkIfBlocked = async (prisma, conversation, currentUserId) => {
      if (conversation.isGroup) {
        return false;
      }

      const otherMember = conversation.members.find(
        (member) => member.userId !== currentUserId
      );

      if (!otherMember || !otherMember.userId) {
        return false;
      }

      const blockCheck = await prisma.block.findFirst({
        where: {
          OR: [
            {
              blockerId: currentUserId,
              blockedId: otherMember.userId,
            },
            {
              blockerId: otherMember.userId,
              blockedId: currentUserId,
            },
          ],
        },
      });

      return !!blockCheck;
    };

    const getBlockByList = async (prisma, conversation, currentUserId) => {
      if (conversation.isGroup) {
        return [];
      }

      const otherMember = conversation.members.find(
        (member) => member.userId !== currentUserId
      );

      if (!otherMember || !otherMember.userId) {
        return [];
      }

      const blocks = await prisma.block.findMany({
        where: {
          OR: [
            {
              blockerId: currentUserId,
              blockedId: otherMember.userId,
            },
            {
              blockerId: otherMember.userId,
              blockedId: currentUserId,
            },
          ],
        },
        select: {
          blockerId: true,
        },
      });

      return blocks.map((block) => block.blockerId);
    };

    const transformConversation = async (
      conversation,
      currentUserId,
      unreadCount,
      prisma
    ) => {
      const participantIds = getParticipantIds(conversation.members);
      const isBlocked = await checkIfBlocked(prisma, conversation, currentUserId);
      const blockBy = await getBlockByList(prisma, conversation, currentUserId);

      return {
        ...conversation,
        members: processConversationMembers(
          conversation.members,
          conversation.isGroup,
          currentUserId
        ),
        messages: conversation.messages.map((message: any) =>
          transformMessage(message, participantIds)
        ),
        avatar: conversation.avatar
          ? getImageUrl(conversation.avatar)
          : null,
        unreadCount,
        isBlocked,
        blockBy, // Add blockBy array for frontend
      };
    };

    const parsePaginationParams = (query: any) => {
      const page = Math.max(parseInt(query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(query.limit) || 10, 1), 100);
      const lastMessageLimit = Math.min(
        Math.max(parseInt(query.message) || 50, 1),
        100
      );

      return {
        page,
        limit,
        lastMessageLimit,
        skip: (page - 1) * limit,
      };
    };

    const { page, limit, lastMessageLimit, skip } = parsePaginationParams(
      request.query
    );

    const whereClause = {
      members: {
        some: {
          userId: currentUserId,
          isDeleted: false,
          isArchived: true,
        },
      },
    };

    const [totalItems, conversations] = await Promise.all([
      prisma.conversation.count({ where: whereClause }),
      prisma.conversation.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          members: {
            where: { isDeleted: false },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
            },
          },
          messages: {
            where: {
              NOT: { deletedForUsers: { array_contains: currentUserId } },
            },
            orderBy: { createdAt: "desc" },
            take: lastMessageLimit,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
              MessageFile: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    const conversationIds = conversations.map((conv) => conv.id);
    const unreadCountsMap = await batchCountUnreadMessages(
      prisma,
      conversationIds,
      currentUserId
    );

    const transformedConversations = await Promise.all(
      conversations.map(async (conversation) =>
        transformConversation(
          conversation,
          currentUserId,
          unreadCountsMap[conversation.id] || 0,
          prisma
        )
      )
    );

    const totalPages = Math.ceil(totalItems / limit);

    return reply.send({
      success: true,
      data: transformedConversations,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    request.log.error(error, "Error getting archived conversations");
    return reply.status(500).send({
      success: false,
      message: "Failed to get archived conversations",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

