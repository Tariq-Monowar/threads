import fp from "fastify-plugin"
import * as admin from "firebase-admin"

function initFirebase(): boolean {
  if (admin.apps.length) {
    console.log("[FIREBASE] Already initialized, apps count:", admin.apps.length)
    return true
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!serviceAccountJson) {
    console.error("[FIREBASE] ❌ FIREBASE_SERVICE_ACCOUNT env variable is missing or empty")
    console.error("[FIREBASE] Please set FIREBASE_SERVICE_ACCOUNT environment variable with your Firebase service account JSON")
    return false
  }

  try {
    console.log("[FIREBASE] Attempting to initialize Firebase Admin SDK...")
    const credentials = JSON.parse(serviceAccountJson)

    // Validate required fields
    if (!credentials.project_id) {
      console.error("[FIREBASE] ❌ Missing project_id in service account credentials")
      return false
    }
    if (!credentials.private_key) {
      console.error("[FIREBASE] ❌ Missing private_key in service account credentials")
      return false
    }
    if (!credentials.client_email) {
      console.error("[FIREBASE] ❌ Missing client_email in service account credentials")
      return false
    }

    // Fix escaped newlines in private key - handle multiple escape patterns
    if (credentials.private_key) {
      let privateKey = String(credentials.private_key);
      
      // Handle different escape patterns
      if (privateKey.includes('\\\\n')) {
        privateKey = privateKey.replace(/\\\\n/g, "\n");
      }
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, "\n");
      }
      
      // Validate private key format
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.error("[FIREBASE] ❌ Private key format is invalid - missing BEGIN marker")
        return false
      }
      if (!privateKey.includes('-----END PRIVATE KEY-----')) {
        console.error("[FIREBASE] ❌ Private key format is invalid - missing END marker")
        return false
      }
      
      credentials.private_key = privateKey;
    }

    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    })

    console.log("[FIREBASE] ✅ Firebase Admin SDK initialized successfully")
    console.log("[FIREBASE] Project ID:", credentials.project_id)
    console.log("[FIREBASE] Client Email:", credentials.client_email)
    return true
  } catch (err: any) {
    console.error("[FIREBASE] ❌ Firebase initialization failed:")
    console.error("[FIREBASE] Error message:", err?.message || err)
    console.error("[FIREBASE] Error stack:", err?.stack)
    if (err instanceof SyntaxError) {
      console.error("[FIREBASE] The FIREBASE_SERVICE_ACCOUNT JSON is invalid. Please check the JSON format.")
    }
    return false
  }
}

export default fp(async (fastify) => {
  const isInitialized = initFirebase()

  if (isInitialized) {
    fastify.log.info("[FIREBASE] ✅ Push notifications ready")
    console.log("[FIREBASE] ✅ Push notifications plugin loaded successfully")
  } else {
    fastify.log.error("[FIREBASE] ❌ Push notifications not configured: check FIREBASE_SERVICE_ACCOUNT")
    console.error("[FIREBASE] ❌ Push notifications will not work until Firebase is properly configured")
  }

  // Always decorate sendDataPush, even if initialization failed (so it can retry)
  fastify.decorate(
    "sendDataPush",
    async (token: string, data: Record<string, string>) => {
      // Try to initialize if not already initialized
      if (!admin.apps.length) {
        console.warn("[PUSH] Firebase not initialized, attempting to initialize now...")
        const retryInit = initFirebase()
        if (!retryInit) {
          console.error("[PUSH] ❌ Firebase Admin SDK not initialized. admin.apps.length =", admin.apps.length)
          console.error("[PUSH] Check server startup logs for Firebase initialization errors")
          console.error("[PUSH] Verify FIREBASE_SERVICE_ACCOUNT environment variable is set correctly")
          return { 
            success: false, 
            error: "Push notifications not configured - Firebase Admin SDK not initialized. Check FIREBASE_SERVICE_ACCOUNT environment variable." 
          }
        }
      }

      console.log("[PUSH] Sending notification to token:", token.substring(0, 20) + "...");
      console.log("[PUSH] Data payload:", data);

      try {
        // Extract notification title and body from data if available
        let notificationTitle = "New Message";
        let notificationBody = "You have a new message!";
        
        if (data.title) {
          notificationTitle = String(data.title);
        }
        if (data.body) {
          notificationBody = String(data.body);
        }

        const messageId = await admin.messaging().send({
          token,
          notification: {
            title: notificationTitle,
            body: notificationBody,
          },
          data: {
            ...data,
            // Ensure data is stringified if it's an object
            data: typeof data.data === 'string' ? data.data : JSON.stringify(data.data || {}),
          },
          android: {
            priority: "high" as const,
            notification: {
              sound: "default",
              channelId: "default",
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
        })
        
        console.log("[PUSH] ✅ Notification sent successfully, messageId:", messageId);
        return { success: true, messageId }
      } catch (error: any) {
        // Handle specific Firebase errors
        const errorCode = error?.code || error?.errorInfo?.code
        const errorMessage = error?.message || error?.errorInfo?.message || "Unknown error"
        
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
            shouldRemoveToken: true
          }
        }
        
        // Invalid credential errors
        if (
          errorCode === "app/invalid-credential" ||
          errorCode === "messaging/mismatched-credential" ||
          errorMessage.includes("Invalid JWT Signature") ||
          errorMessage.includes("invalid_grant")
        ) {
          console.error("[PUSH] ❌ Invalid credential error")
          console.error("[PUSH] Error details:", errorMessage)
          console.error("[PUSH] Possible causes:")
          console.error("[PUSH]   1. Server time is not synced - run: sudo ntpdate -s time.nist.gov")
          console.error("[PUSH]   2. Private key is corrupted or revoked")
          console.error("[PUSH]   3. Service account key has been deleted")
          return { 
            success: false, 
            error: "Invalid Firebase credentials. Check server time sync and verify service account key.",
            code: errorCode
          }
        }
        
        // Other errors
        console.error("[PUSH] Push error:", error)
        console.error("[PUSH] Error code:", errorCode)
        console.error("[PUSH] Error message:", errorMessage)
        return { 
          success: false, 
          error: errorMessage,
          code: errorCode
        }
      }
    }
  )
})

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
    }>
  }
}
