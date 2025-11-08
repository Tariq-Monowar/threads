import { FileService } from "../../../../utils/fileService";
import { transformMessage } from "../../../../utils/message.utils";
import { getImageUrl } from "../../../../utils/baseurl";

/**
 * Helper: Get participant user IDs from conversation members
 */
const getParticipantIds = (members: any[]): number[] => {
  return members
    .map((member) => member.userId)
    .filter((id): id is number => typeof id === "number");
};

/**
 * Helper: Get conversation with members, admin, and messages
 */
const getGroupConversationWithDetails = async (
  prisma: any,
  conversationId: string,
  currentUserId?: number
) => {
  return await prisma.conversation.findUnique({
    where: { id: conversationId },
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
      admin: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      messages: {
        where: currentUserId
          ? {
              NOT: { deletedForUsers: { has: currentUserId } },
            }
          : undefined,
        orderBy: { createdAt: "asc" },
        take: 50,
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
  });
};

/**
 * Helper: Verify user is group admin
 */
const verifyGroupAdmin = async (
  prisma: any,
  conversationId: string,
  userId: number
): Promise<boolean> => {
  const member = await prisma.conversationMember.findFirst({
    where: {
      conversationId,
      userId,
      isAdmin: true,
    },
  });
  return !!member;
};

/**
 * Helper: Verify user is member of group
 */
const verifyGroupMember = async (
  prisma: any,
  conversationId: string,
  userId: number
) => {
  return await prisma.conversationMember.findFirst({
    where: {
      conversationId,
      userId,
      isDeleted: false,
    },
  });
};

/**
 * Helper: Check if users exist
 */
const verifyUsersExist = async (
  prisma: any,
  userIds: number[]
): Promise<boolean> => {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
  });
  return users.length === userIds.length;
};

/**
 * Helper: Format conversation response with avatar URLs and transformed messages
 */
const formatConversationResponse = (conversation: any, currentUserId?: number) => {
  if (!conversation) return null;

  const participantIds = getParticipantIds(conversation.members || []);

  // Transform messages like private conversations
  const transformedMessages = (conversation.messages || []).map((message: any) =>
    transformMessage(message, participantIds)
  );

  return {
    ...conversation,
    avatar: conversation.avatar
      ? getImageUrl(conversation.avatar)
      : null,
    members: conversation.members.map((member: any) => ({
      ...member,
      user: member.user
        ? {
            ...member.user,
            avatar: member.user.avatar
              ? FileService.avatarUrl(member.user.avatar)
              : null,
          }
        : null,
    })),
    admin: conversation.admin
      ? {
          ...conversation.admin,
          avatar: conversation.admin.avatar
            ? FileService.avatarUrl(conversation.admin.avatar)
            : null,
        }
      : null,
    messages: transformedMessages,
  };
};

/**
 * Helper: Parse user IDs from array
 */
const parseUserIds = (userIds: any[]): number[] => {
  return userIds.map((id) => parseInt(id)).filter((id) => !isNaN(id));
};

export const createGroupChat = async (request, reply) => {
  try {
    const { name, userIds, adminId } = request.body;
    const prisma = request.server.prisma;

    // Get avatar from file upload (if provided)
    const avatarFile = (request.file as any) || null;
    const avatar = avatarFile?.filename || null;

    // Validate required fields (name and avatar are optional)
    if (!userIds || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "userIds and adminId are required!",
      });
    }

    // Parse userIds if it's a string (from form-data)
    let parsedUserIds: any[] = userIds;
    if (typeof userIds === "string") {
      try {
        parsedUserIds = JSON.parse(userIds);
      } catch (error) {
        // If JSON parse fails, try splitting by comma
        parsedUserIds = userIds
          .replace(/[\[\]]/g, "")
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
      }
    }

    if (!Array.isArray(parsedUserIds) || parsedUserIds.length < 2) {
      return reply.status(400).send({
        success: false,
        message: "At least 2 users are required to create a group",
      });
    }

    const adminIdInt = parseInt(adminId);
    const userIdsInt = parseUserIds(parsedUserIds);

    if (isNaN(adminIdInt) || userIdsInt.length !== parsedUserIds.length) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user IDs provided!",
      });
    }

    // Check if all users exist
    const allUserIds = [...userIdsInt, adminIdInt];
    const usersExist = await verifyUsersExist(prisma, allUserIds);

    if (!usersExist) {
      return reply.status(404).send({
        success: false,
        message: "Some users not found",
      });
    }

    // Create group conversation
    const conversation = await prisma.conversation.create({
      data: {
        name: name || null,
        isGroup: true,
        avatar: avatar || null,
        adminId: adminIdInt,
        members: {
          create: [
            { userId: adminIdInt, isAdmin: true },
            ...userIdsInt.map((userId) => ({
              userId,
              isAdmin: false,
            })),
          ],
        },
      },
      include: {
        members: {
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
        admin: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        messages: {
          take: 0, // New group has no messages
        },
      },
    });

    const formattedConversation = formatConversationResponse(conversation, adminIdInt);

    return reply.status(201).send({
      success: true,
      message: "Group chat created successfully",
      data: formattedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error creating group chat");
    return reply.status(500).send({
      success: false,
      message: "Failed to create group chat",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const updateGroupPermissions = async (request, reply) => {
  try {
    const {
      conversationId,
      adminId,
      allowMemberAdd,
      allowMemberMessage,
      allowEditGroupInfo,
    } = request.body;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and adminId are required!",
      });
    }

    const adminIdInt = parseInt(adminId);
    if (isNaN(adminIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid adminId provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        isGroup: true,
      },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify user is admin
    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only group admin can update permissions",
      });
    }

    // Build update data only with provided boolean fields
    const updateData: any = {};
    if (typeof allowMemberAdd === "boolean") {
      updateData.allowMemberAdd = allowMemberAdd;
    }
    if (typeof allowMemberMessage === "boolean") {
      updateData.allowMemberMessage = allowMemberMessage;
    }
    if (typeof allowEditGroupInfo === "boolean") {
      updateData.allowEditGroupInfo = allowEditGroupInfo;
    }

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({
        success: false,
        message: "At least one permission field must be provided",
      });
    }

    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    return reply.send({
      success: true,
      message: "Permissions updated successfully",
      data: updatedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error updating group permissions");
    return reply.status(500).send({
      success: false,
      message: "Failed to update permissions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const addUsersToGroup = async (request, reply) => {
  try {
    const { userIds, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !userIds || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId, userIds, and adminId are required!",
      });
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "userIds must be a non-empty array",
      });
    }

    const adminIdInt = parseInt(adminId);
    const userIdsInt = parseUserIds(userIds);

    if (isNaN(adminIdInt) || userIdsInt.length !== userIds.length) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user IDs provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Check permissions
    const userMember = await verifyGroupMember(
      prisma,
      conversationId,
      adminIdInt
    );

    if (!userMember) {
      return reply.status(403).send({
        success: false,
        message: "You are not a member of this group",
      });
    }

    const isAdmin = userMember.isAdmin;
    const canAddMembers = isAdmin || conversation.allowMemberAdd;

    if (!canAddMembers) {
      return reply.status(403).send({
        success: false,
        message: "You don't have permission to add users",
      });
    }

    // Check if new users exist
    const usersExist = await verifyUsersExist(prisma, userIdsInt);

    if (!usersExist) {
      return reply.status(404).send({
        success: false,
        message: "Some users not found",
      });
    }

    // Check if users are already in group
    const existingMembers = await prisma.conversationMember.findMany({
      where: {
        conversationId,
        userId: { in: userIdsInt },
        isDeleted: false,
      },
    });

    if (existingMembers.length > 0) {
      const existingUserIds = existingMembers
        .map((member) => member.userId)
        .filter(Boolean);
      return reply.status(400).send({
        success: false,
        message: `Users already in group: ${existingUserIds.join(", ")}`,
      });
    }

    // Add users to group
    await prisma.conversationMember.createMany({
      data: userIdsInt.map((userId) => ({
        userId,
        conversationId,
        isAdmin: false,
      })),
    });

    // Get updated conversation
    const updatedConversation = await getGroupConversationWithDetails(
      prisma,
      conversationId,
      adminIdInt
    );

    const formattedConversation =
      formatConversationResponse(updatedConversation, adminIdInt);

    return reply.send({
      success: true,
      message: "Users added successfully",
      data: formattedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error adding users to group");
    return reply.status(500).send({
      success: false,
      message: "Failed to add users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const removeUsersFromGroup = async (request, reply) => {
  try {
    const { userIds, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !userIds || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId, userIds, and adminId are required!",
      });
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "userIds must be a non-empty array",
      });
    }

    const adminIdInt = parseInt(adminId);
    const userIdsInt = parseUserIds(userIds);

    if (isNaN(adminIdInt) || userIdsInt.length !== userIds.length) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user IDs provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify requester is admin
    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only group admin can remove users",
      });
    }

    // Prevent admin from removing themselves
    if (userIdsInt.includes(adminIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Admin cannot remove themselves from the group",
      });
    }

    // Check if users to remove are in the group
    const existingMembers = await prisma.conversationMember.findMany({
      where: {
        conversationId,
        userId: { in: userIdsInt },
        isDeleted: false,
      },
    });

    if (existingMembers.length === 0) {
      return reply.status(404).send({
        success: false,
        message: "No specified users found in the group",
      });
    }

    const existingUserIds = existingMembers
      .map((member) => member.userId)
      .filter(Boolean);

    // Check if all specified users exist in the group
    const nonExistingUsers = userIdsInt.filter(
      (userId) => !existingUserIds.includes(userId)
    );

    if (nonExistingUsers.length > 0) {
      return reply.status(404).send({
        success: false,
        message: `Some users not found in group: ${nonExistingUsers.join(", ")}`,
      });
    }

    // Remove users from group
    await prisma.conversationMember.deleteMany({
      where: {
        conversationId,
        userId: { in: userIdsInt },
      },
    });

    // Get updated conversation
    const updatedConversation = await getGroupConversationWithDetails(
      prisma,
      conversationId,
      adminIdInt
    );

    const formattedConversation =
      formatConversationResponse(updatedConversation, adminIdInt);

    return reply.send({
      success: true,
      message: "Users removed successfully",
      data: formattedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error removing users from group");
    return reply.status(500).send({
      success: false,
      message: "Failed to remove users from group",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const leaveFromGroup = async (request, reply) => {
  try {
    const { userId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !userId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and userId are required!",
      });
    }

    const userIdInt = parseInt(userId);
    if (isNaN(userIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid userId provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify user is member
    const member = await verifyGroupMember(prisma, conversationId, userIdInt);

    if (!member) {
      return reply.status(403).send({
        success: false,
        message: "You are not a member of this group",
      });
    }

    // Prevent admin from leaving (they must transfer admin or destroy group)
    if (member.isAdmin) {
      return reply.status(400).send({
        success: false,
        message:
          "Group admin cannot leave. Transfer admin rights or destroy the group instead.",
      });
    }

    // Remove user from group
    await prisma.conversationMember.delete({
      where: { id: member.id },
    });

    return reply.send({
      success: true,
      message: "Left group successfully",
      data: {
        conversationId,
        userId: userIdInt,
      },
    });
  } catch (error) {
    request.log.error(error, "Error leaving group");
    return reply.status(500).send({
      success: false,
      message: "Failed to leave group",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const makeGroupAdmin = async (request, reply) => {
  try {
    const { targetUserId, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !targetUserId || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId, targetUserId, and adminId are required!",
      });
    }

    const adminIdInt = parseInt(adminId);
    const targetUserIdInt = parseInt(targetUserId);

    if (isNaN(adminIdInt) || isNaN(targetUserIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user IDs provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify requester is current admin
    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only current group admin can assign new admin",
      });
    }

    // Verify target user is member
    const targetMember = await verifyGroupMember(
      prisma,
      conversationId,
      targetUserIdInt
    );

    if (!targetMember) {
      return reply.status(404).send({
        success: false,
        message: "Target user is not a member of this group",
      });
    }

    // Prevent making yourself admin (already admin)
    if (targetUserIdInt === adminIdInt) {
      return reply.status(400).send({
        success: false,
        message: "You are already the group admin",
      });
    }

    // Transfer admin: remove admin from current admin, make target user admin, update conversation adminId
    await prisma.$transaction([
      prisma.conversationMember.update({
        where: { id: targetMember.id },
        data: { isAdmin: true },
      }),
      prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: adminIdInt,
          isAdmin: true,
        },
        data: { isAdmin: false },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { adminId: targetUserIdInt },
      }),
    ]);

    // Get updated conversation
    const updatedConversation = await getGroupConversationWithDetails(
      prisma,
      conversationId,
      adminIdInt
    );

    const formattedConversation =
      formatConversationResponse(updatedConversation, adminIdInt);

    return reply.send({
      success: true,
      message: "Group admin changed successfully",
      data: formattedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error making group admin");
    return reply.status(500).send({
      success: false,
      message: "Failed to make group admin",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const removeGroupAdmin = async (request, reply) => {
  try {
    const { targetUserId, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !targetUserId || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId, targetUserId, and adminId are required!",
      });
    }

    const adminIdInt = parseInt(adminId);
    const targetUserIdInt = parseInt(targetUserId);

    if (isNaN(adminIdInt) || isNaN(targetUserIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid user IDs provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify requester is current admin
    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only group admin can remove admin rights",
      });
    }

    // Prevent removing yourself as admin
    if (targetUserIdInt === adminIdInt) {
      return reply.status(400).send({
        success: false,
        message: "You cannot remove your own admin rights",
      });
    }

    // Verify target user is admin
    const targetMember = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: targetUserIdInt,
        isAdmin: true,
      },
    });

    if (!targetMember) {
      return reply.status(404).send({
        success: false,
        message: "Target user is not a group admin",
      });
    }

    // Remove admin rights
    await prisma.conversationMember.update({
      where: { id: targetMember.id },
      data: { isAdmin: false },
    });

    // Get updated conversation
    const updatedConversation = await getGroupConversationWithDetails(
      prisma,
      conversationId,
      adminIdInt
    );

    const formattedConversation =
      formatConversationResponse(updatedConversation, adminIdInt);

    return reply.send({
      success: true,
      message: "Admin rights removed successfully",
      data: formattedConversation,
    });
  } catch (error) {
    request.log.error(error, "Error removing group admin");
    return reply.status(500).send({
      success: false,
      message: "Failed to remove group admin",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const destroyGroup = async (request, reply) => {
  try {
    const { adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !adminId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and adminId are required!",
      });
    }

    const adminIdInt = parseInt(adminId);
    if (isNaN(adminIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid adminId provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, isGroup: true },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify requester is admin
    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);

    if (!isAdmin) {
      return reply.status(403).send({
        success: false,
        message: "Only group admin can destroy the group",
      });
    }

    // Delete all members and then the conversation (cascade will handle messages)
    await prisma.$transaction([
      prisma.conversationMember.deleteMany({
        where: { conversationId },
      }),
      prisma.conversation.delete({
        where: { id: conversationId },
      }),
    ]);

    return reply.send({
      success: true,
      message: "Group destroyed successfully",
      data: {
        conversationId,
      },
    });
  } catch (error) {
    request.log.error(error, "Error destroying group");
    return reply.status(500).send({
      success: false,
      message: "Failed to destroy group",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const updateGroupInfo = async (request, reply) => {
  try {
    const { userId, name } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    // Validate required fields
    if (!conversationId || !userId) {
      return reply.status(400).send({
        success: false,
        message: "conversationId and userId are required!",
      });
    }

    const userIdInt = parseInt(userId);
    if (isNaN(userIdInt)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid userId provided!",
      });
    }

    // Verify conversation exists and is a group
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        isGroup: true,
      },
      select: {
        id: true,
        avatar: true,
        allowEditGroupInfo: true,
      },
    });

    if (!conversation) {
      return reply.status(404).send({
        success: false,
        message: "Group not found",
      });
    }

    // Verify user is member
    const member = await verifyGroupMember(prisma, conversationId, userIdInt);

    if (!member) {
      return reply.status(403).send({
        success: false,
        message: "You are not a member of this group",
      });
    }

    // Check permissions: admin can always edit, members can edit if allowEditGroupInfo is true
    const isAdmin = member.isAdmin;
    const canEdit = isAdmin || conversation.allowEditGroupInfo;

    if (!canEdit) {
      return reply.status(403).send({
        success: false,
        message: "You don't have permission to edit group info",
      });
    }

    // Get new avatar from file upload (if provided)
    const avatarFile = (request.file as any) || null;
    const newAvatar = avatarFile?.filename || null;

    // Build update data
    const updateData: any = {};
    
    if (name !== undefined) {
      updateData.name = name || null;
    }

    if (newAvatar) {
      // Delete old avatar file if exists
      if (conversation.avatar) {
        try {
          FileService.removeFiles([conversation.avatar]);
        } catch (error) {
          request.log.warn({ error }, "Failed to delete old avatar");
        }
      }
      updateData.avatar = newAvatar;
    }

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({
        success: false,
        message: "At least name or avatar must be provided",
      });
    }

    // Update conversation
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    // Get full conversation details
    const fullConversation = await getGroupConversationWithDetails(
      prisma,
      conversationId,
      userIdInt
    );

    const formattedConversation =
      formatConversationResponse(fullConversation, userIdInt);

    return reply.send({
      success: true,
      message: "Group info updated successfully",
      data: formattedConversation,
    });
  } catch (error) {
    // Clean up uploaded file on error
    try {
      const avatarFile = (request.file as any) || null;
      if (avatarFile?.filename) {
        FileService.removeFiles([avatarFile.filename]);
      }
    } catch (_) {}

    request.log.error(error, "Error updating group info");
    return reply.status(500).send({
      success: false,
      message: "Failed to update group info",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};






