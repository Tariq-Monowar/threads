/**
 * Migration Script: PostgreSQL to MySQL
 * 
 * This script migrates all data from PostgreSQL to MySQL,
 * converting array fields (String[], Int[]) to JSON format.
 * 
 * Usage: ts-node scripts/migrate-postgres-to-mysql.ts
 */

import { PrismaClient as PostgresClient } from '@prisma/client/postgres';
import { PrismaClient as MysqlClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

// PostgreSQL connection
const postgresUrl = 'postgresql://postgres:root@31.97.236.206:5432/threads';
const postgresPrisma = new PostgresClient({
  datasources: {
    db: {
      url: postgresUrl,
    },
  },
});

// MySQL connection
const mysqlUrl = 'mysql://threads:root@31.97.236.206:3306/threads';
const mysqlPrisma = new MysqlClient({
  datasources: {
    db: {
      url: mysqlUrl,
    },
  },
});

// Helper function to convert array to JSON
function arrayToJson(value: any): any {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [];
}

// Helper function to log progress
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Helper function to handle errors
function handleError(error: any, context: string) {
  console.error(`\n❌ Error in ${context}:`, error);
  throw error;
}

async function migrateUsers() {
  log('📦 Starting User migration...');
  
  const users = await postgresPrisma.user.findMany({
    orderBy: { id: 'asc' },
  });

  log(`Found ${users.length} users to migrate`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    try {
      // Convert fcmToken array to JSON
      const fcmToken = arrayToJson(user.fcmToken);

      await mysqlPrisma.user.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          name: user.name,
          email: user.email,
          password: user.password,
          avatar: user.avatar,
          address: user.address,
          fcmToken: fcmToken,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        update: {
          name: user.name,
          email: user.email,
          password: user.password,
          avatar: user.avatar,
          address: user.address,
          fcmToken: fcmToken,
          updatedAt: user.updatedAt,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${users.length} users`);
      }
    } catch (error) {
      handleError(error, `migrating user ${user.id}`);
    }
  }

  log(`✅ Completed User migration: ${users.length} users`);
}

async function migrateConversations() {
  log('📦 Starting Conversation migration...');
  
  const conversations = await postgresPrisma.conversation.findMany({
    orderBy: { id: 'asc' },
  });

  log(`Found ${conversations.length} conversations to migrate`);

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    
    try {
      // Convert adminIds array to JSON
      const adminIds = arrayToJson(conv.adminIds);

      await mysqlPrisma.conversation.upsert({
        where: { id: conv.id },
        create: {
          id: conv.id,
          name: conv.name,
          isGroup: conv.isGroup,
          avatar: conv.avatar,
          adminIds: adminIds,
          allowMemberAdd: conv.allowMemberAdd,
          allowMemberMessage: conv.allowMemberMessage,
          allowEditGroupInfo: conv.allowEditGroupInfo,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        },
        update: {
          name: conv.name,
          isGroup: conv.isGroup,
          avatar: conv.avatar,
          adminIds: adminIds,
          allowMemberAdd: conv.allowMemberAdd,
          allowMemberMessage: conv.allowMemberMessage,
          allowEditGroupInfo: conv.allowEditGroupInfo,
          updatedAt: conv.updatedAt,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${conversations.length} conversations`);
      }
    } catch (error) {
      handleError(error, `migrating conversation ${conv.id}`);
    }
  }

  log(`✅ Completed Conversation migration: ${conversations.length} conversations`);
}

async function migrateConversationMembers() {
  log('📦 Starting ConversationMember migration...');
  
  const members = await postgresPrisma.conversationMember.findMany({
    orderBy: { id: 'asc' },
  });

  log(`Found ${members.length} conversation members to migrate`);

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    
    try {
      await mysqlPrisma.conversationMember.upsert({
        where: { id: member.id },
        create: {
          id: member.id,
          userId: member.userId,
          conversationId: member.conversationId,
          isAdmin: member.isAdmin,
          isDeleted: member.isDeleted,
          deletedAt: member.deletedAt,
          isArchived: member.isArchived,
          archivedAt: member.archivedAt,
          isMute: member.isMute,
          muteAt: member.muteAt,
        },
        update: {
          userId: member.userId,
          conversationId: member.conversationId,
          isAdmin: member.isAdmin,
          isDeleted: member.isDeleted,
          deletedAt: member.deletedAt,
          isArchived: member.isArchived,
          archivedAt: member.archivedAt,
          isMute: member.isMute,
          muteAt: member.muteAt,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${members.length} conversation members`);
      }
    } catch (error) {
      handleError(error, `migrating conversation member ${member.id}`);
    }
  }

  log(`✅ Completed ConversationMember migration: ${members.length} members`);
}

async function migrateMessages() {
  log('📦 Starting Message migration...');
  
  const messages = await postgresPrisma.message.findMany({
    orderBy: { createdAt: 'asc' },
  });

  log(`Found ${messages.length} messages to migrate`);

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    
    try {
      // Convert deletedForUsers array to JSON
      const deletedForUsers = arrayToJson(message.deletedForUsers);

      await mysqlPrisma.message.upsert({
        where: { id: message.id },
        create: {
          id: message.id,
          text: message.text,
          userId: message.userId,
          conversationId: message.conversationId,
          deletedForUsers: deletedForUsers,
          isRead: message.isRead,
          isDelivered: message.isDelivered,
          isSystemMessage: message.isSystemMessage,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        },
        update: {
          text: message.text,
          userId: message.userId,
          conversationId: message.conversationId,
          deletedForUsers: deletedForUsers,
          isRead: message.isRead,
          isDelivered: message.isDelivered,
          isSystemMessage: message.isSystemMessage,
          updatedAt: message.updatedAt,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${messages.length} messages`);
      }
    } catch (error) {
      handleError(error, `migrating message ${message.id}`);
    }
  }

  log(`✅ Completed Message migration: ${messages.length} messages`);
}

async function migrateMessageFiles() {
  log('📦 Starting MessageFile migration...');
  
  const files = await postgresPrisma.messageFile.findMany({
    orderBy: { createdAt: 'asc' },
  });

  log(`Found ${files.length} message files to migrate`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    try {
      await mysqlPrisma.messageFile.upsert({
        where: { id: file.id },
        create: {
          id: file.id,
          userId: file.userId,
          messageId: file.messageId,
          fileUrl: file.fileUrl,
          fileType: file.fileType,
          fileSize: file.fileSize,
          fileExtension: file.fileExtension,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        },
        update: {
          userId: file.userId,
          messageId: file.messageId,
          fileUrl: file.fileUrl,
          fileType: file.fileType,
          fileSize: file.fileSize,
          fileExtension: file.fileExtension,
          updatedAt: file.updatedAt,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${files.length} message files`);
      }
    } catch (error) {
      handleError(error, `migrating message file ${file.id}`);
    }
  }

  log(`✅ Completed MessageFile migration: ${files.length} files`);
}

async function migrateCalls() {
  log('📦 Starting Call migration...');
  
  const calls = await postgresPrisma.call.findMany({
    orderBy: { startedAt: 'asc' },
  });

  log(`Found ${calls.length} calls to migrate`);

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    
    try {
      // Convert participantIds array to JSON
      const participantIds = arrayToJson(call.participantIds);

      await mysqlPrisma.call.upsert({
        where: { id: call.id },
        create: {
          id: call.id,
          callerId: call.callerId,
          receiverId: call.receiverId,
          conversationId: call.conversationId,
          participantIds: participantIds,
          type: call.type,
          status: call.status,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
        },
        update: {
          callerId: call.callerId,
          receiverId: call.receiverId,
          conversationId: call.conversationId,
          participantIds: participantIds,
          type: call.type,
          status: call.status,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${calls.length} calls`);
      }
    } catch (error) {
      handleError(error, `migrating call ${call.id}`);
    }
  }

  log(`✅ Completed Call migration: ${calls.length} calls`);
}

async function migrateBlocks() {
  log('📦 Starting Block migration...');
  
  const blocks = await postgresPrisma.block.findMany({
    orderBy: { id: 'asc' },
  });

  log(`Found ${blocks.length} blocks to migrate`);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    
    try {
      await mysqlPrisma.block.upsert({
        where: { id: block.id },
        create: {
          id: block.id,
          blockerId: block.blockerId,
          blockedId: block.blockedId,
          createdAt: block.createdAt,
        },
        update: {
          blockerId: block.blockerId,
          blockedId: block.blockedId,
        },
      });

      if ((i + 1) % 100 === 0) {
        log(`  ✓ Migrated ${i + 1}/${blocks.length} blocks`);
      }
    } catch (error) {
      handleError(error, `migrating block ${block.id}`);
    }
  }

  log(`✅ Completed Block migration: ${blocks.length} blocks`);
}

async function main() {
  try {
    log('🚀 Starting PostgreSQL to MySQL migration...\n');

    // Test connections
    log('🔌 Testing database connections...');
    await postgresPrisma.$connect();
    log('  ✓ PostgreSQL connected');
    
    await mysqlPrisma.$connect();
    log('  ✓ MySQL connected\n');

    // Run migrations in order (respecting foreign key constraints)
    await migrateUsers();
    await migrateConversations();
    await migrateConversationMembers();
    await migrateMessages();
    await migrateMessageFiles();
    await migrateCalls();
    await migrateBlocks();

    log('\n🎉 Migration completed successfully!');
    
    // Get final counts
    log('\n📊 Final record counts in MySQL:');
    const counts = {
      users: await mysqlPrisma.user.count(),
      conversations: await mysqlPrisma.conversation.count(),
      conversationMembers: await mysqlPrisma.conversationMember.count(),
      messages: await mysqlPrisma.message.count(),
      messageFiles: await mysqlPrisma.messageFile.count(),
      calls: await mysqlPrisma.call.count(),
      blocks: await mysqlPrisma.block.count(),
    };
    
    console.table(counts);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await postgresPrisma.$disconnect();
    await mysqlPrisma.$disconnect();
    log('🔌 Database connections closed');
  }
}

// Run migration
main();

