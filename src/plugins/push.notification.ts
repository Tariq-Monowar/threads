import fp from "fastify-plugin"
import * as admin from "firebase-admin"

function initFirebase(): boolean {
  if (admin.apps.length) return true

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!serviceAccountJson) {
    console.warn("FIREBASE_SERVICE_ACCOUNT env variable missing")
    return false
  }

  try {
    const credentials = JSON.parse(serviceAccountJson)

    // Fix escaped newlines in private key
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n")
    }

    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    })

    console.log("Firebase initialized")
    return true
  } catch (err) {
    console.error("Firebase initialization failed:", err)
    return false
  }
}

export default fp(async (fastify) => {
  const isInitialized = initFirebase()

  if (isInitialized) {
    fastify.log.info("Push notifications ready")
  } else {
    fastify.log.warn("Push notifications not configured: check FIREBASE_SERVICE_ACCOUNT")
  }

  fastify.decorate(
    "sendDataPush",
    async (token: string, data: Record<string, string>) => {
      if (!admin.apps.length) {
        return { success: false, error: "Push notifications not configured" }
      }

      console.log("[PUSH] Sending notification to token:", token.substring(0, 20) + "...");
      console.log("[PUSH] Data payload:", data);

      try {
        // Extract notification title and body from data if available
        let notificationTitle = "New Message";
        let notificationBody = "You have a new message!";
        
        if (data.type === "new_message") {
          try {
            const messageDataStr = data.data || "{}";
            const messageData = typeof messageDataStr === 'string' 
              ? JSON.parse(messageDataStr) 
              : messageDataStr;
            
            const senderName = messageData?.user?.name || messageData?.user?.email || "Someone";
            const messageText = messageData?.text || "";
            const isGroup = messageData?.isGroup || false;
            const hasFiles = messageData?.MessageFile && Array.isArray(messageData.MessageFile) && messageData.MessageFile.length > 0;
            
            if (isGroup && messageData?.conversationName) {
              notificationTitle = messageData.conversationName;
              if (hasFiles) {
                notificationBody = `${senderName} sent ${messageData.MessageFile.length} file(s)`;
              } else if (messageText) {
                const preview = messageText.substring(0, 50);
                notificationBody = `${senderName}: ${preview}${messageText.length > 50 ? '...' : ''}`;
              } else {
                notificationBody = `${senderName} sent a message`;
              }
            } else {
              notificationTitle = senderName;
              if (hasFiles) {
                notificationBody = `Sent ${messageData.MessageFile.length} file(s)`;
              } else if (messageText) {
                const preview = messageText.substring(0, 100);
                notificationBody = preview + (messageText.length > 100 ? '...' : '');
              } else {
                notificationBody = "Sent a message";
              }
            }
          } catch (e) {
            // Fallback to default if parsing fails
            console.warn("[PUSH] Failed to parse message data for notification:", e);
            console.warn("[PUSH] Raw data:", data);
          }
        } else if (data.type === "call_initiate") {
          try {
            let callerInfo: any = data.callerInfo;
            if (typeof callerInfo === 'string') {
              callerInfo = JSON.parse(callerInfo);
            }
            const callerName = callerInfo?.name || "Someone";
            const callType = data.callType === "video" ? "video" : "audio";
            notificationTitle = "Incoming Call";
            notificationBody = `${callerName} is calling you (${callType})`;
          } catch (e) {
            console.warn("[PUSH] Failed to parse call data for notification:", e);
          }
        } else if (data.type === "call_ended") {
          notificationTitle = "Call Ended";
          notificationBody = data.reason === "completed" ? "Call completed" : "Call canceled";
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
        
        // Invalid token errors - don't log as error, just return failure
        if (
          errorCode === "messaging/registration-token-not-registered" ||
          errorCode === "messaging/invalid-registration-token" ||
          errorCode === "messaging/invalid-argument"
        ) {
          // Token is invalid/expired - silently fail (token should be removed from DB)
          return { 
            success: false, 
            error: "Invalid or expired token",
            code: errorCode,
            shouldRemoveToken: true
          }
        }
        
        // Other errors - log but don't throw
        console.error("Push error:", error)
        return { 
          success: false, 
          error: error?.message || "Failed to send push notification",
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