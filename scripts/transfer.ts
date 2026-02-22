/**
 * Full database transfer: database2 (source) → database1 (destination).
 * Copies every table and every column from the Prisma schema in FK order.
 * Uses batched inserts for large tables and verifies row counts after.
 *
 * Usage: npm run transfer
 * Or: ts-node scripts/transfer.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const database1 = 'mysql://threads:root@139.59.13.42:3306/threads';
const database2 = 'mysql://threads:root@31.97.236.206:3306/threads';

const BATCH_SIZE = 500;

const source = new PrismaClient({
  datasources: { db: { url: database2 } },
});

const dest = new PrismaClient({
  datasources: { db: { url: database1 } },
});

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function batchCreateMany<T, D>(
  name: string,
  all: T[],
  toData: (row: T) => D,
  insert: (data: D[]) => Promise<unknown>,
) {
  if (all.length === 0) {
    log(`   ${name}: 0 rows`);
    return;
  }
  let inserted = 0;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const chunk = all.slice(i, i + BATCH_SIZE).map(toData);
    await insert(chunk);
    inserted += chunk.length;
    if (all.length > BATCH_SIZE) {
      log(`   ${name}: ${inserted}/${all.length}`);
    }
  }
  log(`   ${name}: ${all.length} rows`);
}

async function transfer() {
  try {
    log('🚀 Full transfer: database2 (source) → database1 (destination)');
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

    // 2. Copy every table, every column, in FK order (batched)
    log('📤 Copying users (all columns)...');
    const users = await source.user.findMany({ orderBy: { id: 'asc' } });
    await batchCreateMany(
      'users',
      users,
      (u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        password: u.password,
        avatar: u.avatar,
        address: u.address,
        fcmToken: u.fcmToken as object,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }),
      (data) => dest.user.createMany({ data }),
    );

    log('📤 Copying blocks (all columns)...');
    const blocks = await source.block.findMany({ orderBy: { id: 'asc' } });
    await batchCreateMany(
      'blocks',
      blocks,
      (b) => ({
        id: b.id,
        blockerId: b.blockerId,
        blockedId: b.blockedId,
        createdAt: b.createdAt,
      }),
      (data) => dest.block.createMany({ data }),
    );

    log('📤 Copying conversations (all columns)...');
    const conversations = await source.conversation.findMany();
    await batchCreateMany(
      'conversations',
      conversations,
      (c) => ({
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
      }),
      (data) => dest.conversation.createMany({ data }),
    );

    log('📤 Copying conversation_members (all columns)...');
    const members = await source.conversationMember.findMany();
    await batchCreateMany(
      'conversation_members',
      members,
      (m) => ({
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
      }),
      (data) => dest.conversationMember.createMany({ data }),
    );

    log('📤 Copying messages (all columns)...');
    const messages = await source.message.findMany({ orderBy: { createdAt: 'asc' } });
    await batchCreateMany(
      'messages',
      messages,
      (m) => ({
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
      }),
      (data) => dest.message.createMany({ data }),
    );

    log('📤 Copying message_files (all columns)...');
    const messageFiles = await source.messageFile.findMany();
    await batchCreateMany(
      'message_files',
      messageFiles,
      (f) => ({
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
      }),
      (data) => dest.messageFile.createMany({ data }),
    );

    log('📤 Copying calls (all columns)...');
    const calls = await source.call.findMany();
    await batchCreateMany(
      'calls',
      calls,
      (c) => ({
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
      }),
      (data) => dest.call.createMany({ data }),
    );

    // 3. Verify: same row counts in source and destination
    log('🔍 Verifying row counts...');
    const [sc, dc] = await Promise.all([
      source.user.count(),
      dest.user.count(),
    ]);
    if (sc !== dc) throw new Error(`users: source ${sc} vs dest ${dc}`);
    const [sb, db] = await Promise.all([source.block.count(), dest.block.count()]);
    if (sb !== db) throw new Error(`blocks: source ${sb} vs dest ${db}`);
    const [sconv, dconv] = await Promise.all([
      source.conversation.count(),
      dest.conversation.count(),
    ]);
    if (sconv !== dconv) throw new Error(`conversations: source ${sconv} vs dest ${dconv}`);
    const [smem, dmem] = await Promise.all([
      source.conversationMember.count(),
      dest.conversationMember.count(),
    ]);
    if (smem !== dmem) throw new Error(`conversation_members: source ${smem} vs dest ${dmem}`);
    const [smsg, dmsg] = await Promise.all([source.message.count(), dest.message.count()]);
    if (smsg !== dmsg) throw new Error(`messages: source ${smsg} vs dest ${dmsg}`);
    const [smf, dmf] = await Promise.all([
      source.messageFile.count(),
      dest.messageFile.count(),
    ]);
    if (smf !== dmf) throw new Error(`message_files: source ${smf} vs dest ${dmf}`);
    const [scall, dcall] = await Promise.all([source.call.count(), dest.call.count()]);
    if (scall !== dcall) throw new Error(`calls: source ${scall} vs dest ${dcall}`);

    log('✅ Verified: users, blocks, conversations, conversation_members, messages, message_files, calls');
    log('✨ Full transfer complete.');
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
