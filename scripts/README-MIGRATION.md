# PostgreSQL to MySQL Migration Script

This script migrates all data from PostgreSQL to MySQL, converting array fields to JSON format.

## Prerequisites

1. Install required dependencies:
```bash
npm install pg mysql2 @types/pg
```

2. Ensure both databases are accessible:
   - PostgreSQL: `postgresql://postgres:root@31.97.236.206:5432/threads`
   - MySQL: `mysql://threads:root@31.97.236.206:3306/threads`

3. Ensure MySQL database schema is already created (run Prisma migrations first)

## Usage

Run the migration script:

```bash
npm run migrate:postgres-to-mysql
```

Or directly:

```bash
ts-node scripts/migrate-postgres-to-mysql-simple.ts
```

## What it does

1. **Connects to both databases** (PostgreSQL source, MySQL destination)

2. **Migrates all tables in order**:
   - `users` (converts `fcmToken` array to JSON)
   - `conversations` (converts `adminIds` array to JSON)
   - `conversation_members`
   - `messages` (converts `deletedForUsers` array to JSON)
   - `message_files`
   - `calls` (converts `participantIds` array to JSON)
   - `blocks`

3. **Converts array fields**:
   - PostgreSQL arrays (e.g., `{value1,value2}`) → JSON arrays `["value1","value2"]`
   - Handles both string and integer arrays

4. **Uses UPSERT** (INSERT ... ON DUPLICATE KEY UPDATE) to handle duplicates

5. **Shows progress** with batch processing (100 records at a time)

6. **Displays final counts** for verification

## Array Field Conversions

| Field | PostgreSQL Type | MySQL Type | Conversion |
|-------|----------------|------------|------------|
| `users.fcmToken` | `String[]` | `Json` | Array → JSON array |
| `conversations.adminIds` | `Int[]` | `Json` | Array → JSON array |
| `messages.deletedForUsers` | `Int[]` | `Json` | Array → JSON array |
| `calls.participantIds` | `Int[]` | `Json` | Array → JSON array |

## Notes

- The script uses `ON DUPLICATE KEY UPDATE` to handle existing records
- Progress is logged every 100 records
- Errors for individual records are logged but don't stop the migration
- The script processes records in batches for better performance

## Troubleshooting

If you encounter connection errors:
1. Verify database credentials
2. Check network connectivity to the database server
3. Ensure both databases are running

If you encounter data type errors:
1. Ensure MySQL schema matches the Prisma schema (with JSON types)
2. Run `npx prisma migrate dev` first to create the MySQL schema

