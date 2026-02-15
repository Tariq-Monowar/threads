/**
 * Transfer all data from database2 (source) to database1 (destination).
 * Uses two PrismaClient instances with different connection URLs.
 *
 * Usage: npm run transfer
 * Or: ts-node scripts/transfer.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const database1 = 'mysql://threads:root@139.59.13.42:3306/threads';
const database2 = 'mysql://threads:root@31.97.236.206:3306/threads';

const source = new PrismaClient({
  datasources: { db: { url: database2 } },
});

const dest = new PrismaClient({
  datasources: { db: { url: database1 } },
});

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function transfer() {
  try {
    log('🚀 Transfer: database2 (source) → database1 (destination)');
    await source.$connect();
    await dest.$connect();
    log('✅ Both databases connected');

    // 1. Clear destination in reverse FK order
    log('🗑 Clearing destination tables...');
    await dest.call.deleteMany({});
    await dest.messageFile.deleteMany({});
    await dest.message.deleteMany({});
    await dest.conversationMember.deleteMany({});
    await dest.conversation.deleteMany({});
    await dest.block.deleteMany({});
    await dest.user.deleteMany({});
    log('✅ Destination cleared');

    // 2. Copy in FK order
    log('📤 Copying users...');
    const users = await source.user.findMany({ orderBy: { id: 'asc' } });
    if (users.length) {
      await dest.user.createMany({
        data: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          password: u.password,
          avatar: u.avatar,
          address: u.address,
          fcmToken: u.fcmToken as object,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
      });
    }
    log(`   ${users.length} users`);

    log('📤 Copying blocks...');
    const blocks = await source.block.findMany({ orderBy: { id: 'asc' } });
    if (blocks.length) {
      await dest.block.createMany({
        data: blocks.map((b) => ({
          id: b.id,
          blockerId: b.blockerId,
          blockedId: b.blockedId,
          createdAt: b.createdAt,
        })),
      });
    }
    log(`   ${blocks.length} blocks`);

    log('📤 Copying conversations...');
    const conversations = await source.conversation.findMany();
    if (conversations.length) {
      await dest.conversation.createMany({
        data: conversations.map((c) => ({
          id: c.id,
          name: c.name,
          isGroup: c.isGroup,
          avatar: c.avatar,
          adminIds: c.adminIds as object,
          allowMemberAdd: c.allowMemberAdd,
          allowMemberMessage: c.allowMemberMessage,
          allowEditGroupInfo: c.allowEditGroupInfo,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
      });
    }
    log(`   ${conversations.length} conversations`);

    log('📤 Copying conversation members...');
    const members = await source.conversationMember.findMany();
    if (members.length) {
      await dest.conversationMember.createMany({
        data: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          conversationId: m.conversationId,
          isAdmin: m.isAdmin,
          isDeleted: m.isDeleted,
          deletedAt: m.deletedAt,
          isArchived: m.isArchived,
          archivedAt: m.archivedAt,
          isMute: m.isMute,
          muteAt: m.muteAt,
        })),
      });
    }
    log(`   ${members.length} conversation members`);

    log('📤 Copying messages...');
    const messages = await source.message.findMany({ orderBy: { createdAt: 'asc' } });
    if (messages.length) {
      await dest.message.createMany({
        data: messages.map((m) => ({
          id: m.id,
          text: m.text,
          userId: m.userId,
          conversationId: m.conversationId,
          deletedForUsers: m.deletedForUsers as object,
          isRead: m.isRead,
          isDelivered: m.isDelivered,
          isSystemMessage: m.isSystemMessage,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      });
    }
    log(`   ${messages.length} messages`);

    log('📤 Copying message files...');
    const messageFiles = await source.messageFile.findMany();
    if (messageFiles.length) {
      await dest.messageFile.createMany({
        data: messageFiles.map((f) => ({
          id: f.id,
          userId: f.userId,
          messageId: f.messageId,
          fileName: f.fileName,
          fileUrl: f.fileUrl,
          fileType: f.fileType,
          fileSize: f.fileSize,
          fileExtension: f.fileExtension,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        })),
      });
    }
    log(`   ${messageFiles.length} message files`);

    log('📤 Copying calls...');
    const calls = await source.call.findMany();
    if (calls.length) {
      await dest.call.createMany({
        data: calls.map((c) => ({
          id: c.id,
          callerId: c.callerId,
          receiverId: c.receiverId,
          conversationId: c.conversationId,
          participantIds: c.participantIds as object,
          deletedForUsers: c.deletedForUsers as object,
          type: c.type,
          status: c.status,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
        })),
      });
    }
    log(`   ${calls.length} calls`);

    log('✨ Transfer complete.');
  } catch (e) {
    log(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await source.$disconnect();
    await dest.$disconnect();
    log('🔌 Disconnected.');
  }
}

transfer()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
