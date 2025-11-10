import { FileService } from "../../../../utils/fileService";
import { transformMessage } from "../../../../utils/message.utils";
import { getImageUrl } from "../../../../utils/baseurl";

// ============================================================================
// SHARED HELPERS
// ============================================================================

const getParticipantIds = (members) => {
  return members
    .map((member) => member.userId)
    .filter((id): id is number => typeof id === "number");
};

const parseUserIds = (userIds) => {
  return userIds.map((id) => parseInt(id)).filter((id) => !isNaN(id));
};

const parseUserId = (userId)=> {
  const parsed = parseInt(userId);
  return isNaN(parsed) ? null : parsed;
};

const getGroupConversationWithDetails = async (
  prisma,
  conversationId,
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
      // admin: {
      //   select: {
      //     id: true,
      //     name: true,
      //     avatar: true,
      //   },
      // },
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

const formatConversationResponse = (
  conversation: any,
  currentUserId?: number
) => {
  if (!conversation) return null;

  const participantIds = getParticipantIds(conversation.members || []);
  const transformedMessages = (conversation.messages || []).map(
    (message: any) => transformMessage(message, participantIds)
  );

  return {
    ...conversation,
    avatar: conversation.avatar ? getImageUrl(conversation.avatar) : null,
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
    messages: transformedMessages,
  };
};

const verifyGroupExists = async (prisma: any, conversationId: string) => {
  return await prisma.conversation.findFirst({
    where: { id: conversationId, isGroup: true },
  });
};

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

const verifyUsersExist = async (
  prisma: any,
  userIds: number[]
): Promise<boolean> => {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
  });
  return users.length === userIds.length;
};

const sendErrorResponse = (
  reply: any,
  statusCode: number,
  message: string,
  error?: any
) => {
  return reply.status(statusCode).send({
    success: false,
    message,
    error: process.env.NODE_ENV === "development" ? error?.message : undefined,
  });
};

const sendSuccessResponse = (
  reply: any,
  message: string,
  data?: any,
  statusCode = 200
) => {
  return reply.status(statusCode).send({
    success: true,
    message,
    data,
  });
};

// ============================================================================
// CREATE GROUP CHAT HELPERS
// ============================================================================

const parseUserIdsFromRequest = (userIds: any): any[] => {
  if (Array.isArray(userIds)) {
    return userIds;
  }

    if (typeof userIds === "string") {
      try {
      return JSON.parse(userIds);
    } catch {
      return userIds
          .replace(/[\[\]]/g, "")
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
      }
    }

  return [];
};

const validateCreateGroupRequest = (userIds: any, adminId: any) => {
  if (!userIds || !adminId) {
    return { valid: false, message: "userIds and adminId are required!" };
  }

  const parsedUserIds = parseUserIdsFromRequest(userIds);
    if (!Array.isArray(parsedUserIds) || parsedUserIds.length < 2) {
    return {
      valid: false,
        message: "At least 2 users are required to create a group",
    };
    }

  const adminIdInt = parseUserId(adminId);
    const userIdsInt = parseUserIds(parsedUserIds);

  if (!adminIdInt || userIdsInt.length !== parsedUserIds.length) {
    return { valid: false, message: "Invalid user IDs provided!" };
  }

  return { valid: true, adminIdInt, userIdsInt };
};

const createGroupMembers = (adminId: number, userIds: number[]) => {
  return [
    { userId: adminId, isAdmin: true },
    ...userIds.map((userId) => ({ userId, isAdmin: false })),
  ];
};

const createGroupConversation = async (
  prisma,
  name,
  avatar,
  adminId,
  userIds
) => {
  return await prisma.conversation.create({
      data: {
        name: name || null,
        isGroup: true,
        avatar: avatar || null,
      adminId,
        members: {
        create: createGroupMembers(adminId, userIds),
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
        messages: {
        take: 0,
        },
      },
    });
};

export const createGroupChat = async (request: any, reply: any) => {
  try {
    const { name, userIds, adminId } = request.body;
    const prisma = request.server.prisma;

    const avatarFile = (request.file as any) || null;
    const avatar = avatarFile?.filename || null;

    const validation = validateCreateGroupRequest(userIds, adminId);
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt, userIdsInt } = validation as {
      adminIdInt: number;
      userIdsInt: number[];
    };

    const allUserIds = [...userIdsInt, adminIdInt];
    const usersExist = await verifyUsersExist(prisma, allUserIds);
    if (!usersExist) {
      return sendErrorResponse(reply, 404, "Some users not found");
    }

    const conversation = await createGroupConversation(
      prisma,
      name,
      avatar,
      adminIdInt,
      userIdsInt
    );

    const formattedConversation = formatConversationResponse(
      conversation,
      adminIdInt
    );
    return sendSuccessResponse(
      reply,
      "Group chat created successfully",
      formattedConversation,
      201
    );
  } catch (error: any) {
    request.log.error(error, "Error creating group chat");
    return sendErrorResponse(reply, 500, "Failed to create group chat", error);
  }
};

// ============================================================================
// UPDATE GROUP PERMISSIONS HELPERS
// ============================================================================

const validateUpdatePermissionsRequest = (
  conversationId: any,
  adminId: any
) => {
  if (!conversationId || !adminId) {
    return {
      valid: false,
      message: "conversationId and adminId are required!",
    };
  }

  const adminIdInt = parseUserId(adminId);
  if (!adminIdInt) {
    return { valid: false, message: "Invalid adminId provided!" };
  }

  return { valid: true, adminIdInt };
};

const buildPermissionUpdateData = (
  allowMemberAdd: any,
  allowMemberMessage: any,
  allowEditGroupInfo: any
) => {
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

  return updateData;
};

export const updateGroupPermissions = async (request: any, reply: any) => {
  try {
    const {
      conversationId,
      adminId,
      allowMemberAdd,
      allowMemberMessage,
      allowEditGroupInfo,
    } = request.body;
    const prisma = request.server.prisma;

    const validation = validateUpdatePermissionsRequest(
      conversationId,
      adminId
    );
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt } = validation as { adminIdInt: number };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);
    if (!isAdmin) {
      return sendErrorResponse(
        reply,
        403,
        "Only group admin can update permissions"
      );
    }

    const updateData = buildPermissionUpdateData(
      allowMemberAdd,
      allowMemberMessage,
      allowEditGroupInfo
    );

    if (Object.keys(updateData).length === 0) {
      return sendErrorResponse(
        reply,
        400,
        "At least one permission field must be provided"
      );
    }

    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    return sendSuccessResponse(
      reply,
      "Permissions updated successfully",
      updatedConversation
    );
  } catch (error: any) {
    request.log.error(error, "Error updating group permissions");
    return sendErrorResponse(reply, 500, "Failed to update permissions", error);
  }
};

// ============================================================================
// ADD USERS TO GROUP HELPERS
// ============================================================================

const validateAddUsersRequest = (
  conversationId: any,
  userIds: any,
  adminId: any
) => {
    if (!conversationId || !userIds || !adminId) {
    return {
      valid: false,
        message: "conversationId, userIds, and adminId are required!",
    };
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
    return { valid: false, message: "userIds must be a non-empty array" };
    }

  const adminIdInt = parseUserId(adminId);
    const userIdsInt = parseUserIds(userIds);

  if (!adminIdInt || userIdsInt.length !== userIds.length) {
    return { valid: false, message: "Invalid user IDs provided!" };
  }

  return { valid: true, adminIdInt, userIdsInt };
};

const checkUserCanAddMembers = (isAdmin: boolean, allowMemberAdd: boolean) => {
  return isAdmin || allowMemberAdd;
};

const checkUsersAlreadyInGroup = async (
  prisma: any,
  conversationId: string,
  userIds: number[]
) => {
  const existingMembers = await prisma.conversationMember.findMany({
    where: {
      conversationId,
      userId: { in: userIds },
      isDeleted: false,
    },
  });

  if (existingMembers.length > 0) {
    const existingUserIds = existingMembers
      .map((member) => member.userId)
      .filter(Boolean);
    return { alreadyInGroup: true, userIds: existingUserIds };
  }

  return { alreadyInGroup: false, userIds: [] };
};

const addUsersToGroupMembers = async (
  prisma: any,
  conversationId: string,
  userIds: number[]
) => {
  await prisma.conversationMember.createMany({
    data: userIds.map((userId) => ({
      userId,
      conversationId,
      isAdmin: false,
    })),
  });
};

const getAddedUsersInfo = async (prisma: any, userIds: number[]) => {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
    },
  });

  return users.map((user: any) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
  }));
};

const getAllGroupMemberIds = async (prisma: any, conversationId: string) => {
  const members = await prisma.conversationMember.findMany({
    where: {
      conversationId,
      isDeleted: false,
    },
    select: {
      userId: true,
    },
  });

  return members
    .map((member) => member.userId)
    .filter((id): id is number => typeof id === "number");
};

const fetchMembersWithUsers = async (
  prisma: any,
  conversationId: string,
  userIds: number[]
) => {
  const members = await prisma.conversationMember.findMany({
    where: {
      conversationId,
      userId: { in: userIds },
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
  });
  return members;
};

const formatMembers = (members: any[]) => {
  return members.map((m) => ({
    ...m,
    user: m.user
      ? {
          ...m.user,
          avatar: m.user.avatar ? FileService.avatarUrl(m.user.avatar) : null,
        }
      : null,
  }));
};

const emitUsersAddedToGroup = (
  io: any,
  conversationId: string,
  addedUsers: any[],
  allMemberIds: number[]
) => {
  const socketData = {
    success: true,
    message: "Users added to group",
    data: {
      conversationId,
      members: addedUsers,
    },
  };

  allMemberIds.forEach((memberId) => {
    io.to(memberId.toString()).emit("users_added_to_group", socketData);
  });
};


/*
                {
                    "id": "cmhsnblo70004kgd8yq6xnp6m",
                    "userId": 1,
                    "conversationId": "cmhsnblo70001kgd8f83zoqmp",
                    "isAdmin": false,
                    "isDeleted": false,
                    "deletedAt": null,
                    "user": {
                        "id": 1,
                        "name": "deficall.org",
                        "email": "deficall",
                        "avatar": "https://deficall.defilinkteam.org/sys/stores/1718442677332.jpg"
                    }

                    //send emit to new 
*/

export const addUsersToGroup = async (request: any, reply: any) => {
  try {
    const { userIds, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateAddUsersRequest(
      conversationId,
      userIds,
      adminId
    );
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt, userIdsInt } = validation as {
      adminIdInt: number;
      userIdsInt: number[];
    };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const userMember = await verifyGroupMember(
      prisma,
      conversationId,
      adminIdInt
    );
    if (!userMember) {
      return sendErrorResponse(
        reply,
        403,
        "You are not a member of this group"
      );
    }

    const canAddMembers = checkUserCanAddMembers(
      userMember.isAdmin,
      conversation.allowMemberAdd
    );
    if (!canAddMembers) {
      return sendErrorResponse(
        reply,
        403,
        "You don't have permission to add users"
      );
    }

    const usersExist = await verifyUsersExist(prisma, userIdsInt);
    if (!usersExist) {
      return sendErrorResponse(reply, 404, "Some users not found");
    }

    const checkResult = await checkUsersAlreadyInGroup(
      prisma,
      conversationId,
      userIdsInt
    );
    if (checkResult.alreadyInGroup) {
      return sendErrorResponse(
        reply,
        400,
        `Users already in group: ${checkResult.userIds.join(", ")}`
      );
    }

    await addUsersToGroupMembers(prisma, conversationId, userIdsInt);

    const addedMembersRaw = await fetchMembersWithUsers(
      prisma,
      conversationId,
      userIdsInt
    );
    const addedUsers = formatMembers(addedMembersRaw);
    const allMemberIds = await getAllGroupMemberIds(prisma, conversationId);

    setImmediate(() => {
      try {
        emitUsersAddedToGroup(
          request.server.io,
          conversationId,
          addedUsers,
          allMemberIds
        );
      } catch (error) {
        request.log.error(error, "Error emitting socket event");
      }
    });

    return sendSuccessResponse(reply, "Users added successfully", {
      conversationId,
      members: addedUsers,
    });
  } catch (error: any) {
    request.log.error(error, "Error adding users to group");
    return sendErrorResponse(reply, 500, "Failed to add users", error);
  }
};

// ============================================================================
// REMOVE USERS FROM GROUP HELPERS
// ============================================================================

const validateRemoveUsersRequest = (
  conversationId: any,
  userIds: any,
  adminId: any
) => {
  if (!conversationId || !userIds || !adminId) {
    return {
      valid: false,
      message: "conversationId, userIds, and adminId are required!",
    };
  }

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { valid: false, message: "userIds must be a non-empty array" };
  }

  const adminIdInt = parseUserId(adminId);
  const userIdsInt = parseUserIds(userIds);

  if (!adminIdInt || userIdsInt.length !== userIds.length) {
    return { valid: false, message: "Invalid user IDs provided!" };
  }

  return { valid: true, adminIdInt, userIdsInt };
};

const checkUsersInGroup = async (
  prisma: any,
  conversationId: string,
  userIds: number[]
) => {
    const existingMembers = await prisma.conversationMember.findMany({
      where: {
        conversationId,
      userId: { in: userIds },
        isDeleted: false,
      },
    });

      const existingUserIds = existingMembers
        .map((member) => member.userId)
        .filter(Boolean);
  const nonExistingUsers = userIds.filter(
    (userId) => !existingUserIds.includes(userId)
  );

  return { existingUserIds, nonExistingUsers };
};

const removeUsersFromGroupMembers = async (
  prisma: any,
  conversationId: string,
  userIds: number[]
) => {
  await prisma.conversationMember.deleteMany({
    where: {
        conversationId,
      userId: { in: userIds },
    },
  });
};

const getRemovedUsersInfo = async (prisma: any, userIds: number[]) => {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
    },
  });

  return users.map((user: any) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
  }));
};

const emitUsersRemovedFromGroup = (
  io: any,
  conversationId: string,
  removedUsers: any[],
  allMemberIds: number[]
) => {
  const socketData = {
      success: true,
    message: "Users removed from group",
    data: {
      conversationId,
      members: removedUsers,
    },
  };

  allMemberIds.forEach((memberId) => {
    io.to(memberId.toString()).emit("users_removed_from_group", socketData);
  });
};

export const removeUsersFromGroup = async (request: any, reply: any) => {
  try {
    const { userIds, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateRemoveUsersRequest(
      conversationId,
      userIds,
      adminId
    );
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt, userIdsInt } = validation as {
      adminIdInt: number;
      userIdsInt: number[];
    };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);
    if (!isAdmin) {
      return sendErrorResponse(reply, 403, "Only group admin can remove users");
    }

    if (userIdsInt.includes(adminIdInt)) {
      return sendErrorResponse(
        reply,
        400,
        "Admin cannot remove themselves from the group"
      );
    }

    const { existingUserIds, nonExistingUsers } = await checkUsersInGroup(
      prisma,
      conversationId,
      userIdsInt
    );

    if (existingUserIds.length === 0) {
      return sendErrorResponse(
        reply,
        404,
        "No specified users found in the group"
      );
    }

    if (nonExistingUsers.length > 0) {
      return sendErrorResponse(
        reply,
        404,
        `Some users not found in group: ${nonExistingUsers.join(", ")}`
      );
    }

    const removedMembersRaw = await fetchMembersWithUsers(
      prisma,
      conversationId,
      userIdsInt
    );
    const removedUsers = formatMembers(removedMembersRaw);
    const allMemberIds = await getAllGroupMemberIds(prisma, conversationId);

    await removeUsersFromGroupMembers(prisma, conversationId, userIdsInt);

    setImmediate(() => {
      try {
        emitUsersRemovedFromGroup(
          request.server.io,
          conversationId,
          removedUsers,
          allMemberIds
        );
      } catch (error) {
        request.log.error(error, "Error emitting socket event");
      }
    });

    return sendSuccessResponse(reply, "Users removed successfully", {
      conversationId,
      members: removedUsers,
    });
  } catch (error: any) {
    request.log.error(error, "Error removing users from group");
    return sendErrorResponse(
      reply,
      500,
      "Failed to remove users from group",
      error
    );
  }
};

// ============================================================================
// LEAVE FROM GROUP HELPERS
// ============================================================================

const validateLeaveGroupRequest = (conversationId: any, userId: any) => {
  if (!conversationId || !userId) {
    return { valid: false, message: "conversationId and userId are required!" };
  }

  const userIdInt = parseUserId(userId);
  if (!userIdInt) {
    return { valid: false, message: "Invalid userId provided!" };
  }

  return { valid: true, userIdInt };
};

const removeUserFromGroup = async (prisma: any, memberId: string) => {
  await prisma.conversationMember.delete({
    where: { id: memberId },
  });
};

const checkOtherAdminsExist = async (
  prisma: any,
  conversationId: string,
  currentUserId: number
): Promise<boolean> => {
  const otherAdmins = await prisma.conversationMember.findMany({
      where: {
        conversationId,
      userId: { not: currentUserId },
      isAdmin: true,
        isDeleted: false,
      },
    });

  return otherAdmins.length > 0;
};

const getAnotherAdminId = async (
  prisma: any,
  conversationId: string,
  currentUserId: number
): Promise<number | null> => {
  const otherAdmin = await prisma.conversationMember.findFirst({
    where: {
      conversationId,
      userId: { not: currentUserId },
      isAdmin: true,
      isDeleted: false,
    },
  });

  return otherAdmin?.userId || null;
};

const updateConversationAdminId = async (
  prisma: any,
  conversationId: string,
  newAdminId: number
) => {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { adminId: newAdminId },
  });
};

const getLeavingUserInfo = async (prisma: any, userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      },
    });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ? FileService.avatarUrl(user.avatar) : null,
  };
};

const emitUserLeftGroup = (
  io: any,
  conversationId: string,
  leavingMembers: any[],
  allMemberIds: number[]
) => {
  const socketData = {
      success: true,
    message: "User left group",
    data: {
      conversationId,
      members: leavingMembers,
    },
  };

  allMemberIds.forEach((memberId) => {
    io.to(memberId.toString()).emit("user_left_group", socketData);
  });
};

export const leaveFromGroup = async (request: any, reply: any) => {
  try {
    const { userId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateLeaveGroupRequest(conversationId, userId);
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { userIdInt } = validation as { userIdInt: number };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const member = await verifyGroupMember(prisma, conversationId, userIdInt);
    if (!member) {
      return sendErrorResponse(
        reply,
        403,
        "You are not a member of this group"
      );
    }

    if (member.isAdmin) {
      const hasOtherAdmins = await checkOtherAdminsExist(
        prisma,
        conversationId,
        userIdInt
      );

      if (!hasOtherAdmins) {
        return sendErrorResponse(
          reply,
          400,
          "You cannot leave the group. You are the only admin. Transfer admin rights to another member or destroy the group instead."
        );
      }
    }

    const leavingMemberRaw = await fetchMembersWithUsers(
      prisma,
      conversationId,
      [userIdInt]
    );
    const leavingMembers = formatMembers(leavingMemberRaw);
    const allMemberIds = await getAllGroupMemberIds(prisma, conversationId);

    if (member.isAdmin && conversation.adminId === userIdInt) {
      const anotherAdminId = await getAnotherAdminId(prisma, conversationId, userIdInt);
      if (anotherAdminId) {
        await updateConversationAdminId(prisma, conversationId, anotherAdminId);
      }
    }

    await removeUserFromGroup(prisma, member.id);

    setImmediate(() => {
      try {
        emitUserLeftGroup(
          request.server.io,
          conversationId,
          leavingMembers,
          allMemberIds
        );
      } catch (error) {
        request.log.error(error, "Error emitting socket event");
      }
    });

    return sendSuccessResponse(reply, "Left group successfully", {
        conversationId,
      members: leavingMembers,
    });
  } catch (error: any) {
    request.log.error(error, "Error leaving group");
    return sendErrorResponse(reply, 500, "Failed to leave group", error);
  }
};

// ============================================================================
// MAKE GROUP ADMIN HELPERS
// ============================================================================

const validateMakeAdminRequest = (
  conversationId: any,
  targetUserId: any,
  adminId: any
) => {
    if (!conversationId || !targetUserId || !adminId) {
    return {
      valid: false,
        message: "conversationId, targetUserId, and adminId are required!",
    };
  }

  const adminIdInt = parseUserId(adminId);
  const targetUserIdInt = parseUserId(targetUserId);

  if (!adminIdInt || !targetUserIdInt) {
    return { valid: false, message: "Invalid user IDs provided!" };
  }

  return { valid: true, adminIdInt, targetUserIdInt };
};

const addAdminRights = async (
  prisma: any,
  conversationId: string,
  targetMemberId: string
) => {
  await prisma.conversationMember.update({
    where: { id: targetMemberId },
    data: { isAdmin: true },
  });
};

export const makeGroupAdmin = async (request: any, reply: any) => {
  try {
    const { targetUserId, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateMakeAdminRequest(
      conversationId,
      targetUserId,
      adminId
    );
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt, targetUserIdInt } = validation as {
      adminIdInt: number;
      targetUserIdInt: number;
    };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);
    if (!isAdmin) {
      return sendErrorResponse(
        reply,
        403,
        "Only current group admin can assign new admin"
      );
    }

    const targetMember = await verifyGroupMember(
      prisma,
      conversationId,
      targetUserIdInt
    );
    if (!targetMember) {
      return sendErrorResponse(
        reply,
        404,
        "Target user is not a member of this group"
      );
    }

    if (targetMember.isAdmin) {
      return sendErrorResponse(reply, 400, "User is already an admin");
    }

    await addAdminRights(prisma, conversationId, targetMember.id);

    const memberAfterUpdateRaw = await fetchMembersWithUsers(
      prisma,
      conversationId,
      [targetUserIdInt]
    );
    const memberAfterUpdate = formatMembers(memberAfterUpdateRaw);
    return sendSuccessResponse(
      reply,
      "User promoted to admin successfully",
      {
        conversationId,
        members: memberAfterUpdate,
      }
    );
  } catch (error: any) {
    request.log.error(error, "Error making group admin");
    return sendErrorResponse(reply, 500, "Failed to make group admin", error);
  }
};

// ============================================================================
// REMOVE GROUP ADMIN HELPERS
// ============================================================================

const validateRemoveAdminRequest = (
  conversationId: any,
  targetUserId: any,
  adminId: any
) => {
    if (!conversationId || !targetUserId || !adminId) {
    return {
      valid: false,
        message: "conversationId, targetUserId, and adminId are required!",
    };
  }

  const adminIdInt = parseUserId(adminId);
  const targetUserIdInt = parseUserId(targetUserId);

  if (!adminIdInt || !targetUserIdInt) {
    return { valid: false, message: "Invalid user IDs provided!" };
  }

  return { valid: true, adminIdInt, targetUserIdInt };
};

const findAdminMember = async (
  prisma: any,
  conversationId: string,
  userId: number
) => {
  return await prisma.conversationMember.findFirst({
    where: {
      conversationId,
      userId,
      isAdmin: true,
    },
  });
};

const removeAdminRights = async (prisma: any, memberId: string) => {
  await prisma.conversationMember.update({
    where: { id: memberId },
    data: { isAdmin: false },
  });
};

export const removeGroupAdmin = async (request: any, reply: any) => {
  try {
    const { targetUserId, adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateRemoveAdminRequest(
      conversationId,
      targetUserId,
      adminId
    );
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt, targetUserIdInt } = validation as {
      adminIdInt: number;
      targetUserIdInt: number;
    };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);
    if (!isAdmin) {
      return sendErrorResponse(
        reply,
        403,
        "Only group admin can remove admin rights"
      );
    }

    if (targetUserIdInt === adminIdInt) {
      return sendErrorResponse(
        reply,
        400,
        "You cannot remove your own admin rights"
      );
    }

    const targetMember = await findAdminMember(
      prisma,
        conversationId,
      targetUserIdInt
    );
    if (!targetMember) {
      return sendErrorResponse(reply, 404, "Target user is not a group admin");
    }

    await removeAdminRights(prisma, targetMember.id);

    const memberAfterUpdateRaw = await fetchMembersWithUsers(
      prisma,
      conversationId,
      [targetUserIdInt]
    );
    const memberAfterUpdate = formatMembers(memberAfterUpdateRaw);
    return sendSuccessResponse(
      reply,
      "Admin rights removed successfully",
      {
        conversationId,
        members: memberAfterUpdate,
      }
    );
  } catch (error: any) {
    request.log.error(error, "Error removing group admin");
    return sendErrorResponse(reply, 500, "Failed to remove group admin", error);
  }
};

// ============================================================================
// DESTROY GROUP HELPERS
// ============================================================================

const validateDestroyGroupRequest = (conversationId: any, adminId: any) => {
    if (!conversationId || !adminId) {
    return {
      valid: false,
        message: "conversationId and adminId are required!",
    };
  }

  const adminIdInt = parseUserId(adminId);
  if (!adminIdInt) {
    return { valid: false, message: "Invalid adminId provided!" };
  }

  return { valid: true, adminIdInt };
};

const deleteGroupAndMembers = async (prisma: any, conversationId: string) => {
    await prisma.$transaction([
      prisma.conversationMember.deleteMany({
        where: { conversationId },
      }),
      prisma.conversation.delete({
        where: { id: conversationId },
      }),
    ]);
};

export const destroyGroup = async (request: any, reply: any) => {
  try {
    const { adminId } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateDestroyGroupRequest(conversationId, adminId);
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { adminIdInt } = validation as { adminIdInt: number };

    const conversation = await verifyGroupExists(prisma, conversationId);
    if (!conversation) {
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const isAdmin = await verifyGroupAdmin(prisma, conversationId, adminIdInt);
    if (!isAdmin) {
      return sendErrorResponse(
        reply,
        403,
        "Only group admin can destroy the group"
      );
    }

    await deleteGroupAndMembers(prisma, conversationId);

    return sendSuccessResponse(reply, "Group destroyed successfully", {
        conversationId,
    });
  } catch (error: any) {
    request.log.error(error, "Error destroying group");
    return sendErrorResponse(reply, 500, "Failed to destroy group", error);
  }
};

// ============================================================================
// UPDATE GROUP INFO HELPERS
// ============================================================================

const validateUpdateGroupInfoRequest = (conversationId: any, userId: any) => {
  if (!conversationId || !userId) {
    return { valid: false, message: "conversationId and userId are required!" };
  }

  const userIdInt = parseUserId(userId);
  if (!userIdInt) {
    return { valid: false, message: "Invalid userId provided!" };
  }

  return { valid: true, userIdInt };
};

const checkUserCanEditGroupInfo = (
  isAdmin: boolean,
  allowEditGroupInfo: boolean
) => {
  return isAdmin || allowEditGroupInfo;
};

const buildGroupInfoUpdateData = (name: any, newAvatar: string | null) => {
  const updateData: any = {};

  if (name !== undefined) {
    updateData.name = name || null;
  }

  if (newAvatar) {
    updateData.avatar = newAvatar;
  }

  return updateData;
};

const deleteOldAvatar = (oldAvatar: string | null, request: any) => {
  if (oldAvatar) {
    try {
      FileService.removeFiles([oldAvatar]);
    } catch (error) {
      request.log.warn({ error }, "Failed to delete old avatar");
    }
  }
};

const updateGroupConversation = async (
  prisma: any,
  conversationId: string,
  updateData: any
) => {
  return await prisma.conversation.update({
    where: { id: conversationId },
    data: updateData,
  });
};

export const updateGroupInfo = async (request: any, reply: any) => {
  try {
    const { userId, name } = request.body;
    const { conversationId } = request.params;
    const prisma = request.server.prisma;

    const validation = validateUpdateGroupInfoRequest(conversationId, userId);
    if (!validation.valid) {
      return sendErrorResponse(reply, 400, validation.message as string);
    }

    const { userIdInt } = validation as { userIdInt: number };

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
      return sendErrorResponse(reply, 404, "Group not found");
    }

    const member = await verifyGroupMember(prisma, conversationId, userIdInt);
    if (!member) {
      return sendErrorResponse(
        reply,
        403,
        "You are not a member of this group"
      );
    }

    const canEdit = checkUserCanEditGroupInfo(
      member.isAdmin,
      conversation.allowEditGroupInfo
    );
    if (!canEdit) {
      return sendErrorResponse(
        reply,
        403,
        "You don't have permission to edit group info"
      );
    }

    const avatarFile = (request.file as any) || null;
    const newAvatar = avatarFile?.filename || null;

    if (newAvatar) {
      deleteOldAvatar(conversation.avatar, request);
    }

    const updateData = buildGroupInfoUpdateData(name, newAvatar);

    if (Object.keys(updateData).length === 0) {
      return sendErrorResponse(
        reply,
        400,
        "At least name or avatar must be provided"
      );
    }

    await updateGroupConversation(prisma, conversationId, updateData);

    const fullConversation = await getGroupConversationWithDetails(
      prisma,
      conversationId,
      userIdInt
    );

    const formattedConversation = formatConversationResponse(
      fullConversation,
      userIdInt
    );
    return sendSuccessResponse(
      reply,
      "Group info updated successfully",
      formattedConversation
    );
  } catch (error: any) {
    try {
      const avatarFile = (request.file as any) || null;
      if (avatarFile?.filename) {
        FileService.removeFiles([avatarFile.filename]);
      }
    } catch (_) {}

    request.log.error(error, "Error updating group info");
    return sendErrorResponse(reply, 500, "Failed to update group info", error);
  }
};
