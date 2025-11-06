import { getImageUrl } from "../../../utils/baseurl";
import { FileService } from "../../../utils/fileService";

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
            NOT: {
              deletedForUsers: {
                has: parseInt(myId),
              },
            },
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
            MessageFile: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const formatUser = (user) =>
      user
        ? {
            ...user,
            avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
          }
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

    const transformMessage = (msg: any, memberUserIds: number[]) => {
      const base = (() => {
        const clone = { ...msg } as any;
        if ("deletedForUsers" in clone) delete clone.deletedForUsers;
        return clone;
      })();

      const receiverIds = memberUserIds.filter((uid) => uid !== base.userId);

      return {
        ...base,
        senderId: base.userId,
        receiverId: receiverIds,
        user: base.user
          ? {
              ...base.user,
              avatar: base.user.avatar
                ? FileService.avatarUrl(base.user.avatar)
                : null,
            }
          : base.user,
        MessageFile: (base.MessageFile || []).map((f: any) => ({
          ...f,
          fileUrl: f?.fileUrl ? getImageUrl(f.fileUrl) : f.fileUrl,
        })),
      };
    };

    const transformedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            userId: { not: parseInt(myId) },
            NOT: { deletedForUsers: { has: parseInt(myId) } },
          },
        });

        const memberUserIds = (conv.members || [])
          .map((m) => m.userId)
          .filter(Boolean) as number[];

        return {
          ...conv,
          members: processMembers(conv.members, conv.isGroup),
          messages: conv.messages.map((msg: any) => transformMessage(msg, memberUserIds)),
          avatar: conv.avatar ? FileService.avatarUrl(conv.avatar) : null,
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

//convercatio
//filtiring bad jabe without message
// file
