import { baseUrl, getImageUrl } from "../../../utils/baseurl";
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
     * Counts messages from other users that are unread and not deleted for current user
     */
    const batchCountUnreadMessages = async (
      prisma,
      conversationIds,
      currentUserId
    ) => {
      if (conversationIds.length === 0) return {};

      // Count unread messages from other users (not deleted for current user)
      const unreadCounts = await prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversationIds },
          userId: { not: currentUserId },
          isRead: false,
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
     * Helper: Check if conversation is blocked (only for private conversations)
     */
    const checkIfBlocked = async (prisma, conversation, currentUserId) => {
      // Only check for private conversations
      if (conversation.isGroup) {
        return false;
      }

      // Get the other user in private conversation
      const otherMember = conversation.members.find(
        (member) => member.userId !== currentUserId
      );

      if (!otherMember || !otherMember.userId) {
        return false;
      }

      // Check if current user blocked the other user OR other user blocked current user
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

    /**
     * Helper: Get list of blocker IDs for a conversation (only for private conversations)
     */
    const getBlockByList = async (prisma, conversation, currentUserId) => {
      // Only check for private conversations
      if (conversation.isGroup) {
        return [];
      }

      // Get the other user in private conversation
      const otherMember = conversation.members.find(
        (member) => member.userId !== currentUserId
      );

      if (!otherMember || !otherMember.userId) {
        return [];
      }

      // Get all blocking relationships between current user and other user
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

      // Return array of blocker IDs
      return blocks.map((block) => block.blockerId);
    };

    /**
     * Helper: Transform a single conversation
     */
    const transformConversation = async (
      conversation,
      currentUserId,
      unreadCount,
      prisma
    ) => {
      const participantIds = getParticipantIds(conversation.members);
      const isBlocked = await checkIfBlocked(prisma, conversation, currentUserId);
      const blockBy = await getBlockByList(prisma, conversation, currentUserId);
      
      // Get current user's member record to check isMute
      const currentUserMember = conversation.members.find(
        (member) => member.userId === currentUserId
      );
      const isMute = currentUserMember?.isMute || false;

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
        isBlocked, // Add isBlocked field for frontend
        isMute, // Add isMute field for frontend
        blockBy, // Add blockBy array for frontend
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
            isArchived: false, // Exclude archived conversations
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

    // Batch fetch unread counts for all conversations
    const conversationIds = conversations.map((conv) => conv.id);
    const unreadCountsMap = await batchCountUnreadMessages(
      prisma,
      conversationIds,
      currentUserId
    );

    // Transform conversations (with async block check)
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

export const getSingleConversation = async (request, reply) => {
  try {
    const { conversationId } = request.params;
    const { myId } = request.query;
    const { message = 50 } = request.query;
    const prisma = request.server.prisma;

    // Validate conversationId
    if (!conversationId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId is required!",
      });
    }

    // Validate and parse user ID
    if (!myId) {
      return reply.status(400).send({
        success: false,
        message: "myId is required!",
      });
    }

    const currentUserId = parseInt(myId);
    if (isNaN(currentUserId)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user ID provided!",
      });
    }

    // Check if user is a member of the conversation
    const member = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: currentUserId,
        isDeleted: false,
      },
    });

    if (!member) {
      return reply.status(403).send({
        success: false,
        message: "You don't have access to this conversation",
      });
    }

    // Parse message limit from query
    const messageLimit = Math.min(
      Math.max(parseInt(request.query?.message) || 50, 1),
      100
    );

  // ── FETCH CONVERSATION ───────────────────────────────────────────────
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        where: { isDeleted: false },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
      messages: {
        where: {
          NOT: { deletedForUsers: { has: currentUserId } },
        },
        // ── ASCENDING ORDER (oldest first) ────────────────────────
        orderBy: { createdAt: "asc" },
        take: messageLimit,               // use the clamped limit
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          MessageFile: true,
        },
      },
    },
  });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Conversation not found",
      });
    }

    // Helper: Format user with avatar URL
    const formatUserWithAvatar = (user) => {
      if (!user) return null;
      return {
        ...user,
        avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
      };
    };

    // Helper: Process and filter conversation members
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

      // For group conversations, return all members (not limited like in list)
      return formattedMembers;
    };

    // Helper: Get participant user IDs from conversation members
    const getParticipantIds = (members: any[]): number[] => {
      return members
        .map((member) => member.userId)
        .filter((id): id is number => typeof id === "number");
    };

    // Helper: Count unread messages
    const countUnreadMessages = async (prisma, conversationId, currentUserId) => {
      const unreadCount = await prisma.message.count({
        where: {
          conversationId,
          userId: { not: currentUserId },
          isRead: false,
          NOT: { deletedForUsers: { has: currentUserId } },
        },
      });
      return unreadCount;
    };

    // Helper: Check if conversation is blocked (only for private conversations)
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

    // Get participant IDs and unread count
    const participantIds = getParticipantIds(conversation.members);
    const unreadCount = await countUnreadMessages(
      prisma,
      conversationId,
      currentUserId
    );

    // Check if blocked
    const isBlocked = await checkIfBlocked(prisma, conversation, currentUserId);

    // Get blockBy list
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

    const blockBy = await getBlockByList(prisma, conversation, currentUserId);

    // Get current user's member record to check isMute
    const currentUserMember = conversation.members.find(
      (member) => member.userId === currentUserId
    );
    const isMute = currentUserMember?.isMute || false;

    // Transform the conversation
    const transformedConversation = {
      ...conversation,
      members: processConversationMembers(
        conversation.members,
        conversation.isGroup,
        currentUserId
      ),
      messages: conversation.messages
        .reverse() // Reverse to show oldest first
        .map((message: any) => transformMessage(message, participantIds)),
      avatar: conversation.avatar ? getImageUrl(conversation.avatar) : null,
      unreadCount,
      isBlocked, // Add isBlocked field for frontend
      isMute, // Add isMute field for frontend
      blockBy, // Add blockBy array for frontend
    };

    return reply.send({
      success: true,
      data: transformedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error getting single conversation");
    return reply.status(500).send({
      success: false,
      message: "Failed to get conversation",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};