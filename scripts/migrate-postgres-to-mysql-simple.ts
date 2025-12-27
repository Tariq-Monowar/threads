/**
 * Migration Script: PostgreSQL to MySQL (Simple Version)
 * 
 * This script migrates all data from PostgreSQL to MySQL,
 * converting array fields (String[], Int[]) to JSON format.
 * 
 * Usage: ts-node scripts/migrate-postgres-to-mysql-simple.ts
 */

import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import mysql from 'mysql2/promise';

const { Client: PostgresClient } = pg;

// Database connections
const postgresConfig = {
  host: '31.97.236.206',
  port: 5432,
  database: 'threads',
  user: 'postgres',
  password: 'root',
};

const mysqlConfig = {
  host: '31.97.236.206',
  port: 3306,
  database: 'threads',
  user: 'threads',
  password: 'root',
};

// Helper function to log progress
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Helper function to convert PostgreSQL array to JSON array
function arrayToJson(value: any): any {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  // PostgreSQL arrays come as strings like "{value1,value2}" or "{1,2,3}"
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const cleaned = value.slice(1, -1); // Remove { }
    if (cleaned.trim() === '') {
      return [];
    }
    // Handle quoted strings and numbers
    const items = cleaned.split(',').map(item => {
      const trimmed = item.trim();
      // Remove quotes if present
      const unquoted = trimmed.replace(/^"(.*)"$/, '$1');
      // Try to parse as number if possible
      const num = parseInt(unquoted);
      if (!isNaN(num) && unquoted === num.toString()) {
        return num;
      }
      return unquoted;
    });
    return items;
  }
  return [];
}

async function migrateTable(
  postgresClient: PostgresClient,
  mysqlConnection: mysql.Connection,
  tableName: string,
  transformFn?: (row: any) => any
) {
  log(`📦 Starting ${tableName} migration...`);

  // Fetch all rows from PostgreSQL
  const result = await postgresClient.query(`SELECT * FROM ${tableName} ORDER BY id`);
  const rows = result.rows;

  log(`Found ${rows.length} ${tableName} records to migrate`);

  if (rows.length === 0) {
    log(`  ⚠️  No records to migrate for ${tableName}`);
    return;
  }

  // Get column names
  const columns = Object.keys(rows[0]);
  
  // Process in batches
  const batchSize = 100;
  let migrated = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    
    for (const row of batch) {
      try {
        // Transform row if transform function provided
        const transformedRow = transformFn ? transformFn(row) : row;

        // Build INSERT ... ON DUPLICATE KEY UPDATE query
        const placeholders = columns.map(() => '?').join(', ');
        const updateClause = columns
          .filter(col => col !== 'id')
          .map(col => `${col} = ?`)
          .join(', ');

        const values = columns.map(col => {
          const value = transformedRow[col];
          // Convert arrays to JSON strings for MySQL
          if (Array.isArray(value)) {
            return JSON.stringify(value);
          }
          return value;
        });

        const updateValues = columns
          .filter(col => col !== 'id')
          .map(col => {
            const value = transformedRow[col];
            if (Array.isArray(value)) {
              return JSON.stringify(value);
            }
            return value;
          });

        const query = `
          INSERT INTO ${tableName} (${columns.join(', ')})
          VALUES (${placeholders})
          ON DUPLICATE KEY UPDATE ${updateClause}
        `;

        await mysqlConnection.execute(query, [...values, ...updateValues]);
        migrated++;

        if (migrated % 100 === 0) {
          log(`  ✓ Migrated ${migrated}/${rows.length} ${tableName} records`);
        }
      } catch (error: any) {
        log(`  ❌ Error migrating ${tableName} record: ${error.message}`);
        // Continue with next record
      }
    }
  }

  log(`✅ Completed ${tableName} migration: ${migrated}/${rows.length} records`);
}

async function main() {
  const postgresClient = new PostgresClient(postgresConfig);
  const mysqlConnection = await mysql.createConnection(mysqlConfig);

  try {
    log('🚀 Starting PostgreSQL to MySQL migration...\n');

    // Test connections
    log('🔌 Testing database connections...');
    await postgresClient.connect();
    log('  ✓ PostgreSQL connected');
    
    await mysqlConnection.ping();
    log('  ✓ MySQL connected\n');

    // Migrate tables in order (respecting foreign key constraints)
    
    // Transform functions for tables with array fields
    const transformUser = (row: any) => ({
      ...row,
      fcmToken: arrayToJson(row.fcmToken),
    });

    const transformConversation = (row: any) => ({
      ...row,
      adminIds: arrayToJson(row.adminIds),
    });

    const transformMessage = (row: any) => ({
      ...row,
      deletedForUsers: arrayToJson(row.deletedForUsers),
    });

    const transformCall = (row: any) => ({
      ...row,
      participantIds: arrayToJson(row.participantIds),
    });

    await migrateTable(postgresClient, mysqlConnection, 'users', transformUser);
    await migrateTable(postgresClient, mysqlConnection, 'conversations', transformConversation);
    await migrateTable(postgresClient, mysqlConnection, 'conversation_members');
    await migrateTable(postgresClient, mysqlConnection, 'messages', transformMessage);
    await migrateTable(postgresClient, mysqlConnection, 'message_files');
    await migrateTable(postgresClient, mysqlConnection, 'calls', transformCall);
    await migrateTable(postgresClient, mysqlConnection, 'blocks');

    log('\n🎉 Migration completed successfully!');
    
    // Get final counts
    log('\n📊 Final record counts in MySQL:');
    const [counts] = await mysqlConnection.execute(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM conversations) as conversations,
        (SELECT COUNT(*) FROM conversation_members) as conversation_members,
        (SELECT COUNT(*) FROM messages) as messages,
        (SELECT COUNT(*) FROM message_files) as message_files,
        (SELECT COUNT(*) FROM calls) as calls,
        (SELECT COUNT(*) FROM blocks) as blocks
    `);
    
    console.table(counts);

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await postgresClient.end();
    await mysqlConnection.end();
    log('🔌 Database connections closed');
  }
}

// Run migration
main();

