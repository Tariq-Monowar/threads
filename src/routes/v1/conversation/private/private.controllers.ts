import { FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcrypt";
import {
  forgotPasswordEmail,
  otpVerificationEmail,
  sendForgotPasswordOTP,
  sendTwoFactorOtp,
} from "../../../../utils/email.config";

import { generateJwtToken } from "../../../../utils/jwt.utils";
import { getImageUrl } from "../../../../utils/baseurl";
import { FileService } from "../../../../utils/fileService";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { authenticator } from "otplib";
import { uploadsDir } from "../../../../config/storage.config";

// export const createConversation = async (request, reply) => {
//   try {
//     const { otherUserId, myId } = request.body;
//     const prisma = request.server.prisma;

//     const missingField = ["otherUserId", "myId"].find(
//       (field) => !request.body[field]
//     );

//     if (missingField) {
//       return reply.status(400).send({
//         success: false,
//         message: `${missingField} is required!`,
//       });
//     }

//     const otherUserIdInt = parseInt(otherUserId);
//     const myIdInt = parseInt(myId);

//     const activeConversation = await prisma.conversation.findFirst({
//       where: {
//         isGroup: false,
//         AND: [
//           { members: { some: { userId: myIdInt, isDeleted: false } } },
//           { members: { some: { userId: otherUserIdInt, isDeleted: false } } },
//         ],
//       },
//       include: {
//         members: { include: { user: true } },
//       },
//     });

//     if (activeConversation) {
//       const messages = await prisma.message.findMany({
//         where: { conversationId: activeConversation.id },
//         take: 50,
//         orderBy: { createdAt: "asc" },
//       });

//       return reply.send({
//         success: true,
//         data: {
//           ...activeConversation,
//           messages,
//         },
//       });
//     }

//     const deletedConversation = await prisma.conversation.findFirst({
//       where: {
//         isGroup: false,
//         AND: [
//           { members: { some: { userId: myIdInt, isDeleted: true } } },
//           { members: { some: { userId: otherUserIdInt } } },
//         ],
//       },
//     });

//     if (deletedConversation) {
//       const newConversation = await prisma.conversation.create({
//         data: {
//           isGroup: false,
//           members: {
//             create: [{ userId: myIdInt }, { userId: otherUserIdInt }],
//           },
//         },
//         include: {
//           members: { include: { user: true } },
//         },
//       });

//       return reply.send({
//         success: true,
//         data: {
//           ...newConversation,
//           messages: [],
//         },
//         message: "New conversation created (previous conversation was deleted)",
//       });
//     }

//     const conversation = await prisma.conversation.create({
//       data: {
//         isGroup: false,
//         members: {
//           create: [{ userId: myIdInt }, { userId: otherUserIdInt }],
//         },
//       },
//       include: {
//         members: { include: { user: true } },
//       },
//     });

//     return reply.send({
//       success: true,
//       data: {
//         ...conversation,
//         messages: [],
//       },
//     });
//   } catch (error) {
//     console.error("Error creating conversation:", error);
//     return reply
//       .status(500)
//       .send({ success: false, message: "Failed to create chat" });
//   }
// };

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

    const otherUserIdInt = parseInt(otherUserId);
    const myIdInt = parseInt(myId);

    const activeConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: myIdInt, isDeleted: false } } },
          { members: { some: { userId: otherUserIdInt, isDeleted: false } } },
        ],
      },
      include: {
        members: { include: { user: true } },
      },
    });

    const filterForUser = (conversation, userIdToExclude: number) => {
      if (!conversation) return null;
      return {
        ...conversation,
        members: conversation.members.filter(
          (member) => member.userId !== userIdToExclude
        ),
      };
    };

    const filterMyInfo = (conversation) => {
      if (!conversation) return null;
      return {
        ...conversation,
        members: conversation.members.filter(
          (member) => member.userId !== myIdInt
        ),
      };
    };

    if (activeConversation) {
      const messagesRaw = await prisma.message.findMany({
        where: {
          conversationId: activeConversation.id,
          NOT: { deletedForUsers: { has: myIdInt } },
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

      const memberUserIds = (activeConversation.members || [])
        .map((mem) => mem.userId)
        .filter(Boolean) as number[];

      const transformedMessages = messagesRaw.map((m: any) => ({
        ...(() => {
          const clone = { ...m } as any;
          if ("deletedForUsers" in clone) delete clone.deletedForUsers;
          return clone;
        })(),
        senderId: m.userId,
        receiverId: memberUserIds.filter((uid) => uid !== m.userId),
        user: m.user
          ? {
              ...m.user,
              avatar: m.user.avatar ? FileService.avatarUrl(m.user.avatar) : null,
            }
          : m.user,
        MessageFile: (m.MessageFile || []).map((f: any) => ({
          ...f,
          fileUrl: f?.fileUrl ? getImageUrl(f.fileUrl) : f.fileUrl,
        })),
      }));

      const filtered = filterMyInfo(activeConversation);
      const membersWithAvatar = filtered.members.map((mem: any) => ({
        ...mem,
        user: mem.user
          ? {
              ...mem.user,
              avatar: mem.user.avatar
                ? FileService.avatarUrl(mem.user.avatar)
                : null,
            }
          : null,
      }));

      return reply.send({
        success: true,
        data: {
          ...filtered,
          members: membersWithAvatar,
          messages: transformedMessages,
        },
      });
    }

    const deletedConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: myIdInt, isDeleted: true } } },
          { members: { some: { userId: otherUserIdInt } } },
        ],
      },
    });

    if (deletedConversation) {
      const newConversation = await prisma.conversation.create({
        data: {
          isGroup: false,
          members: {
            create: [{ userId: myIdInt }, { userId: otherUserIdInt }],
          },
        },
        include: {
          members: { include: { user: true } },
        },
      });

      const otherMember = newConversation.members.find(
        (m) => m.userId !== myIdInt
      );
      if (otherMember?.userId) {

        let data = {
          ...filterForUser(newConversation, otherMember.userId),
          messages: [],
        };
  
        console.log(data);
        
        request.server.io
          .to(otherMember.userId.toString())
          .emit("conversation_created", {
            success: true,
            data: {
              ...filterForUser(newConversation, otherMember.userId),
              messages: [],
            },
          });
      }

      {
        const filtered = filterMyInfo(newConversation);
        const membersWithAvatar = filtered.members.map((mem: any) => ({
          ...mem,
          user: mem.user
            ? {
                ...mem.user,
                avatar: mem.user.avatar
                  ? FileService.avatarUrl(mem.user.avatar)
                  : null,
              }
            : null,
        }));

        return reply.send({
          success: true,
          data: {
            ...filtered,
            members: membersWithAvatar,
            messages: [],
          },
          message: "New conversation created (previous conversation was deleted)",
        });
      }
    }

    const conversation = await prisma.conversation.create({
      data: {
        isGroup: false,
        members: {
          create: [{ userId: myIdInt }, { userId: otherUserIdInt }],
        },
      },
      include: {
        members: { include: { user: true } },
      },
    });

    const otherMember = conversation.members.find((m) => m.userId !== myIdInt);

    if (otherMember?.userId) {
      let data = {
        ...filterForUser(conversation, otherMember.userId),
        messages: [],
      };

      console.log(data);

      request.server.io
        .to(otherMember.userId.toString())
        .emit("conversation_created", {
          success: true,
          data: {
            ...filterForUser(conversation, otherMember.userId),
            messages: [],
          },
        });
    }

    {
      const filtered = filterMyInfo(conversation);
      const membersWithAvatar = filtered.members.map((mem: any) => ({
        ...mem,
        user: mem.user
          ? {
              ...mem.user,
              avatar: mem.user.avatar
                ? FileService.avatarUrl(mem.user.avatar)
                : null,
            }
          : null,
      }));

      return reply.send({
        success: true,
        data: {
          ...filtered,
          members: membersWithAvatar,
          messages: [],
        },
      });
    }
  } catch (error) {
    console.error("Error creating conversation:", error);
    return reply
      .status(500)
      .send({ success: false, message: "Failed to create chat" });
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
    });
  } catch (error) {
    return reply
      .status(500)
      .send({ success: false, message: "Failed to delete conversation" });
  }
};
