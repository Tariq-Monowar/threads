import { FileService } from "../../../utils/fileService";
import { transformMessage } from "../../../utils/message.utils";

export const getMyConversationsList = async (request, reply) => {
  try {
    const { myId } = request.params;
    const prisma = request.server.prisma;

    // Validate and parse user ID
    const currentUserId = parseInt(myId);
    if (isNaN(currentUserId)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user ID provided!",
      });
    }

    /**
     * Helper: Format user with avatar URL
     */
    const formatUserWithAvatar = (user) => {
      if (!user) return null;
      return {
        ...user,
        avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
      };
    };

    /**
     * Helper: Process and filter conversation members
     */
    const processConversationMembers = (members, isGroup, currentUserId) => {
      const formattedMembers = members.map((member) => ({
        ...member,
        user: formatUserWithAvatar(member.user),
      }));

      // For private conversations, exclude current user
      if (!isGroup) {
        return formattedMembers.filter(
          (member) => member.userId !== currentUserId
        );
      }

      // For group conversations, show current user first, then others (max 3)
      const [currentUserMembers, otherMembers] = formattedMembers.reduce(
        ([current, rest], member) =>
          member.userId === currentUserId
            ? [[...current, member], rest]
            : [current, [...rest, member]],
        [[], []]
      );

      return [...currentUserMembers, ...otherMembers].slice(0, 3);
    };

    /**
     * Helper: Get participant user IDs from conversation members
     */
    const getParticipantIds = (members: any[]): number[] => {
      return members
        .map((member) => member.userId)
        .filter((id): id is number => typeof id === "number");
    };

    /**
     * Helper: Batch count unread messages for multiple conversations
     * Counts all messages from other users that aren't deleted for current user
     */
    const batchCountUnreadMessages = async (
      prisma,
      conversationIds,
      currentUserId
    ) => {
      if (conversationIds.length === 0) return {};

      // Count messages from other users (not deleted for current user)
      const unreadCounts = await prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversationIds },
          userId: { not: currentUserId },
          NOT: { deletedForUsers: { has: currentUserId } },
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

    /**
     * Helper: Transform a single conversation
     */
    const transformConversation = (
      conversation,
      currentUserId,
      unreadCount
    ) => {
      const participantIds = getParticipantIds(conversation.members);

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
          ? FileService.avatarUrl(conversation.avatar)
          : null,
        unreadCount,
      };
    };

    /**
     * Helper: Parse and validate pagination parameters
     */
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

    /**
     * Helper: Build conversation query where clause
     */
    const buildConversationWhereClause = (currentUserId: number) => {
      return {
        members: {
          some: {
            userId: currentUserId,
            isDeleted: false,
          },
        },
      };
    };

    // Parse pagination parameters
    const { page, limit, lastMessageLimit, skip } = parsePaginationParams(
      request.query
    );

    const whereClause = buildConversationWhereClause(currentUserId);

    // Fetch total count and conversations in parallel
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
              NOT: { deletedForUsers: { has: currentUserId } },
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

    // Batch fetch unread counts for all conversations
    const conversationIds = conversations.map((conv) => conv.id);
    const unreadCountsMap = await batchCountUnreadMessages(
      prisma,
      conversationIds,
      currentUserId
    );

    // Transform conversations
    const transformedConversations = conversations.map((conversation) =>
      transformConversation(
        conversation,
        currentUserId,
        unreadCountsMap[conversation.id] || 0
      )
    );

    // Calculate pagination metadata
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
    request.log.error(error, "Error getting conversations");
    return reply.status(500).send({
      success: false,
      message: "Failed to get conversations",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
