/**
 * Script: Clear All FCM Tokens
 * 
 * This script clears all FCM tokens from all users in the database.
 * It sets the fcmToken field to an empty array [] for all users.
 * 
 * Usage: ts-node scripts/clear-fcm-tokens.ts
 * Or: npm run clear:fcm-tokens (if added to package.json)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper function to log progress
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function clearAllFcmTokens() {
  try {
    log('🚀 Starting FCM token clearing process...');

    // Get total user count
    const totalUsers = await prisma.user.count();
    log(`📊 Total users in database: ${totalUsers}`);

    if (totalUsers === 0) {
      log('✅ No users found in database.');
      return;
    }

    // Get sample of users with tokens before clearing (for reporting)
    const sampleUsers = await prisma.user.findMany({
      select: {
        id: true,
        fcmToken: true,
      },
      take: 10,
    });

    const usersWithTokens = sampleUsers.filter(
      (user) => Array.isArray(user.fcmToken) && user.fcmToken.length > 0
    ).length;

    log(`📊 Sample check: Found users with FCM tokens (showing first 10)`);

    // Clear all FCM tokens by updating all users
    // This sets fcmToken to empty array [] for all users
    const result = await prisma.user.updateMany({
      data: {
        fcmToken: [],
      },
    });

    log(`✅ Successfully cleared FCM tokens for ${result.count} users`);

    // Verify the operation by checking a sample
    const verifyUsers = await prisma.user.findMany({
      select: {
        id: true,
        fcmToken: true,
      },
      take: 10,
    });

    const usersStillWithTokens = verifyUsers.filter(
      (user) => Array.isArray(user.fcmToken) && user.fcmToken.length > 0
    ).length;

    if (usersStillWithTokens === 0) {
      log('✅ Verification: All FCM tokens have been cleared successfully');
    } else {
      log(`⚠️  Warning: ${usersStillWithTokens} users still have FCM tokens (sample check)`);
    }

    log('✨ FCM token clearing process completed');

  } catch (error) {
    log(`❌ Error occurred: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await prisma.$disconnect();
    log('🔌 Database connection closed');
  }
}

// Run the script
clearAllFcmTokens()
  .then(() => {
    log('🎉 Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    log(`💥 Script failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
