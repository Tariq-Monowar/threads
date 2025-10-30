import { getImageUrl } from "../../../utils/baseurl";

export const getMyConversationsList = async (request, reply) => {
  try {
    const { myId } = request.params;
    const { page = "1", limit = "10", message = "50" } = request.query as any;
    const prisma = request.server.prisma;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const messageLimit = parseInt(message) || 50;
    const skip = (pageNum - 1) * limitNum;

    const totalItems = await prisma.conversation.count({
      where: {
        members: {
          some: {
            userId: parseInt(myId),
            isDeleted: false,
          },
        },
      },
    });

    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: {
            userId: parseInt(myId),
            isDeleted: false,
          },
        },
      },
      skip,
      take: limitNum,
      include: {
        members: {
          where: {
            isDeleted: false,
          },
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
            AND: [
              {
                NOT: {
                  deletedForMe: {
                    some: {
                      userId: parseInt(myId),
                    },
                  },
                },
              },
              {
                isDeletedForEveryone: false,
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: messageLimit,
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
      },
      orderBy: { updatedAt: "desc" },
    });

    const formatUser = (user) =>
      user
        ? { ...user, avatar: user.avatar ? getImageUrl(user.avatar) : null }
        : null;


    const processMembers = (members, isGroup) => {
      const formatted = members.map((m) => ({
        ...m,
        user: formatUser(m.user),
      }));

      if (!isGroup) {
        return formatted.filter((m) => m.userId !== parseInt(myId));
      }

      const [currentUser, others] = formatted.reduce(
        ([current, rest], m) =>
          m.userId === parseInt(myId)
            ? [[...current, m], rest]
            : [current, [...rest, m]],
        [[], []]
      );

      return [...currentUser, ...others].slice(0, 3);
    };

    const transformedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            isRead: false,
            isDeletedForEveryone: false,
            userId: {
              not: parseInt(myId),
            },
            deletedForMe: {
              none: {
                userId: parseInt(myId),
              },
            },
          },
        });

        return {
          ...conv,
          members: processMembers(conv.members, conv.isGroup),
          messages: conv.messages.map((msg) => ({
            id: msg.id,
            text: msg.text,
            userId: msg.userId,
            conversationId: msg.conversationId,
            isDeletedForEveryone: msg.isDeletedForEveryone,
            deletedForEveryoneAt: msg.deletedForEveryoneAt,
            isRead: msg.isRead,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
            user: formatUser(msg.user),
          })),
          avatar: conv.avatar ? getImageUrl(conv.avatar) : null,
          unreadCount,
        };
      })
    );

    const totalPages = Math.ceil(totalItems / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    return reply.send({
      success: true,
      data: transformedConversations,
      pagination: {
        totalItems,
        totalPages,
        currentPage: pageNum,
        itemsPerPage: limitNum,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("Error getting conversations:", error);
    return reply
      .status(500)
      .send({ success: false, message: "Failed to get conversations" });
  }
};
