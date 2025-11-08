import { FastifyRequest, FastifyReply } from "fastify";
import { FileService } from "../../../../utils/fileService";
import { transformMessage } from "../../../../utils/message.utils";

export const createConversation = async (request, reply) => {
  try {
    const { otherUserId, myId } = request.body;
    const prisma = request.server.prisma;

    const missingField = ["otherUserId", "myId"].find(
      (field) => !request.body[field]
    );
    if (missingField) {
      return reply.status(400).send({
        success: false,
        message: `${missingField} is required!`,
      });
    }

    const currentUserId = parseInt(myId);
    const otherUserIdInt = parseInt(otherUserId);

    if (isNaN(currentUserId) || isNaN(otherUserIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user IDs provided!",
      });
    }

    //-----------------------------
    const formatMembersWithAvatars = (members: any[]) => {
      return members.map((member) => ({
        ...member,
        user: member.user
          ? {
              ...member.user,
              avatar: member.user.avatar
                ? FileService.avatarUrl(member.user.avatar)
                : null,
            }
          : null,
      }));
    };

    /**
     * Helper: Filter conversation to exclude current user's member info
     */
    const excludeCurrentUserFromConversation = (
      conversation: any,
      currentUserId: number
    ) => {
      if (!conversation) return null;
      return {
        ...conversation,
        members: conversation.members.filter(
          (member: any) => member.userId !== currentUserId
        ),
      };
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
     * Helper: Find existing active conversation between two users
     */
    const findActiveConversation = async (
      prisma: any,
      userId1: number,
      userId2: number
    ) => {
      return await prisma.conversation.findFirst({
        where: {
          isGroup: false,
          AND: [
            { members: { some: { userId: userId1, isDeleted: false } } },
            { members: { some: { userId: userId2, isDeleted: false } } },
          ],
        },
        include: {
          members: { include: { user: true } },
        },
      });
    };

    /**
     * Helper: Find deleted conversation that can be restored
     */
    const findDeletedConversation = async (
      prisma: any,
      currentUserId: number,
      otherUserId: number
    ) => {
      return await prisma.conversation.findFirst({
        where: {
          isGroup: false,
          AND: [
            { members: { some: { userId: currentUserId, isDeleted: true } } },
            { members: { some: { userId: otherUserId } } },
          ],
        },
      });
    };

    /**
     * Helper: Create a new private conversation
     */
    const createNewPrivateConversation = async (
      prisma: any,
      userId1: number,
      userId2: number
    ) => {
      return await prisma.conversation.create({
        data: {
          isGroup: false,
          members: {
            create: [{ userId: userId1 }, { userId: userId2 }],
          },
        },
        include: {
          members: { include: { user: true } },
        },
      });
    };

    /**
     * Helper: Fetch and transform messages for a conversation
     */
    const fetchAndTransformMessages = async (
      prisma: any,
      conversationId: string,
      currentUserId: number,
      participantIds: number[]
    ) => {
      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          NOT: { deletedForUsers: { has: currentUserId } },
        },
        take: 50,
        orderBy: { createdAt: "asc" },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          MessageFile: true,
        },
      });

      return messages.map((message: any) =>
        transformMessage(message, participantIds)
      );
    };

    /**
     * Helper: Emit socket event to other user about new conversation
     */
    const notifyOtherUser = (
      io: any,
      otherUserId: number,
      conversation: any,
      currentUserId: number
    ) => {
      const conversationForOtherUser = excludeCurrentUserFromConversation(
        conversation,
        otherUserId
      );

      if (conversationForOtherUser) {
        io.to(otherUserId.toString()).emit("conversation_created", {
          success: true,
          data: {
            ...conversationForOtherUser,
            messages: [],
          },
        });
      }
    };

    /**
     * Helper: Prepare conversation response for current user
     */
    const prepareConversationResponse = (
      conversation: any,
      currentUserId: number,
      messages: any[] = [],
      customMessage?: string
    ) => {
      const filteredConversation = excludeCurrentUserFromConversation(
        conversation,
        currentUserId
      );

      if (!filteredConversation) {
        return null;
      }

      const formattedMembers = formatMembersWithAvatars(
        filteredConversation.members
      );

      const response: any = {
        success: true,
        data: {
          ...filteredConversation,
          members: formattedMembers,
          messages,
        },
      };

      if (customMessage) {
        response.message = customMessage;
      }

      return response;
    };
    //-----------------------------

    const existingConversation = await findActiveConversation(
      prisma,
      currentUserId,
      otherUserIdInt
    );

    if (existingConversation) {
      const participantIds = getParticipantIds(existingConversation.members);
      const messages = await fetchAndTransformMessages(
        prisma,
        existingConversation.id,
        currentUserId,
        participantIds
      );

      const response = prepareConversationResponse(
        existingConversation,
        currentUserId,
        messages
      );

      return reply.send(response);
    }

    // Check for deleted conversation (for message only, we always create new)
    const deletedConversation = await findDeletedConversation(
      prisma,
      currentUserId,
      otherUserIdInt
    );

    // Always create a new conversation
    const newConversation = await createNewPrivateConversation(
      prisma,
      currentUserId,
      otherUserIdInt
    );

    // Notify other user via socket
    const otherMember = newConversation.members.find(
      (member: any) => member.userId !== currentUserId
    );

    if (otherMember?.userId) {
      notifyOtherUser(
        request.server.io,
        otherMember.userId,
        newConversation,
        currentUserId
      );
    }

    // Prepare response
    const responseMessage = deletedConversation
      ? "New conversation created (previous conversation was deleted)"
      : undefined;

    const response = prepareConversationResponse(
      newConversation,
      currentUserId,
      [],
      responseMessage
    );

    return reply.send(response);
  } catch (error) {
    request.log.error(error, "Error creating conversation");
    return reply.status(500).send({
      success: false,
      message: "Failed to create conversation",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


export const deleteConversationForMe = async (request, reply) => {
  try {
    const { conversationId } = request.params;
    const { myId } = request.body;
    const prisma = request.server.prisma;

    if (!conversationId || !myId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and myId are required!",
      });
    }

    const myIdInt = parseInt(myId);

    await prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: myIdInt,
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return reply.send({
      success: true,
      message: "Conversation deleted successfully",
      data: {
        conversationId,
      },
    });
  } catch (error) {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to delete conversation" });
  }
};
