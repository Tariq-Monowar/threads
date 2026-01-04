import fp from "fastify-plugin";
import * as admin from "firebase-admin";

function initFirebase(): boolean {
  if (admin.apps.length) return true;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    console.warn("FIREBASE_SERVICE_ACCOUNT env variable missing");
    return false;
  }

  try {
    const credentials = JSON.parse(serviceAccountJson);

    // Fix escaped newlines in private key
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }

    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    });

    console.log("Firebase initialized");
    return true;
  } catch (err) {
    console.error("Firebase initialization failed:", err);
    return false;
  }
}

export default fp(async (fastify) => {
  const isInitialized = initFirebase();

  if (isInitialized) {
    fastify.log.info("Push notifications ready");
  } else {
    fastify.log.warn(
      "Push notifications not configured: check FIREBASE_SERVICE_ACCOUNT"
    );
  }

  fastify.decorate(
    "sendDataPush",
    async (token: string, data: Record<string, string>) => {
      if (!admin.apps.length) {
        return { success: false, error: "Push notifications not configured" };
      }

      console.log("================================================", data);

      try {
        const fcmData: Record<string, string> = {};
        for (const [key, value] of Object.entries(data)) {
          if (key === "data") {
            fcmData.data =
              typeof value === "string"
                ? value
                : JSON.stringify(value || {});
          } else {
            fcmData[key] = String(value || "");
          }
        }

        // Ensure type is always included and is a string
        if (!fcmData.type) {
          fcmData.type = "notification";
        }

        const messageId = await admin.messaging().send({
          token,
          notification: {
            title: data.title || "New Message",
            body: data.body || "You have a new message!",
          },
          data: fcmData,
          android: {
            priority: "high",
            notification: {
              sound: "default",
              channelId: "high_importance_channel",
              tag: `msg_${data.conversationId || "general"}`,
            },
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1,
              },
            },
          },
        });

        return { success: true, messageId };
      } catch (error: any) {
        const errorCode = error?.code || error?.errorInfo?.code;
        const errorMessage =
          error?.message || error?.errorInfo?.message || "Unknown error";

        // Permission errors
        if (
          errorMessage.includes("Permission") ||
          errorMessage.includes("denied") ||
          errorCode === "messaging/mismatched-credential"
        ) {
          console.error(
            "[PUSH] ❌ Permission error - Service account lacks FCM permissions"
          );
          console.error("[PUSH] Error:", errorMessage);
          console.error(
            "[PUSH] Fix: Grant 'Firebase Cloud Messaging API Service Agent' role to service account"
          );
          console.error("[PUSH] Steps:");
          console.error(
            "[PUSH]   1. Go to: https://console.cloud.google.com/iam-admin/iam?project=deficall"
          );
          console.error(
            "[PUSH]   2. Find: backend@deficall.iam.gserviceaccount.com"
          );
          console.error("[PUSH]   3. Click Edit (pencil icon)");
          console.error(
            "[PUSH]   4. Add role: 'Firebase Cloud Messaging API Service Agent'"
          );
          console.error(
            "[PUSH]   5. Save and wait 1-2 minutes for changes to propagate"
          );

          return {
            success: false,
            error:
              "Service account lacks permission to send push notifications. Grant 'Firebase Cloud Messaging API Service Agent' role to backend@deficall.iam.gserviceaccount.com",
            code: errorCode,
          };
        }

        // Invalid token errors
        if (
          errorCode === "messaging/registration-token-not-registered" ||
          errorCode === "messaging/invalid-registration-token" ||
          errorCode === "messaging/invalid-argument"
        ) {
          return {
            success: false,
            error: "Invalid or expired token",
            code: errorCode,
            shouldRemoveToken: true,
          };
        }

        // Invalid credential errors
        if (
          errorCode === "app/invalid-credential" ||
          errorMessage.includes("Invalid JWT Signature") ||
          errorMessage.includes("invalid_grant")
        ) {
          console.error("[PUSH] ❌ Invalid credential error");
          console.error("[PUSH] Error:", errorMessage);
          console.error(
            "[PUSH] Fix: Check server time sync and verify service account key"
          );

          return {
            success: false,
            error:
              "Invalid Firebase credentials. Check server time sync and verify service account key.",
            code: errorCode,
          };
        }

        console.error("[PUSH] Push error:", error);
        return {
          success: false,
          error: errorMessage,
          code: errorCode,
        };
      }
    }
  );
});

declare module "fastify" {
  interface FastifyInstance {
    sendDataPush: (
      token: string,
      data: Record<string, string>
    ) => Promise<{
      success: boolean;
      messageId?: string;
      error?: string;
      code?: string;
      shouldRemoveToken?: boolean;
    }>;
  }
}
