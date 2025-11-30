import fp from "fastify-plugin"
import * as admin from "firebase-admin"

// Notification types
type NotificationType = "incoming_call" | "new_message" | string

interface NotificationData {
  type: NotificationType
  [key: string]: string | undefined
}

interface NotificationPayload {
  title: string
  body: string
}

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

/**
 * Generate notification title and body based on notification type
 */
function generateNotificationPayload(data: NotificationData): NotificationPayload | undefined {
  const notificationType = data.type

  switch (notificationType) {
    case "incoming_call": {
      try {
        const callerInfo = data.callerInfo ? JSON.parse(data.callerInfo) : null
        const callerName = callerInfo?.name || "Someone"
        const callType = data.callType === "video" ? "video" : "audio"
        return {
          title: "Incoming Call",
          body: `${callerName} is calling you (${callType})`,
        }
      } catch (error) {
        return {
          title: "Incoming Call",
          body: `You have an incoming ${data.callType || "call"}`,
        }
      }
    }

    case "new_message": {
      try {
        const messageData = data.data ? JSON.parse(data.data) : null
        const senderName = messageData?.user?.name || messageData?.senderName || "Someone"
        const messageText = messageData?.text || ""
        const isGroup = messageData?.isGroup || false
        const conversationName = messageData?.conversationName || null

        // Truncate long messages
        const truncatedText = messageText.length > 50 
          ? messageText.substring(0, 50) + "..." 
          : messageText

        // Check if message has files
        const hasFiles = messageData?.MessageFile && messageData.MessageFile.length > 0
        const fileCount = hasFiles ? messageData.MessageFile.length : 0

        let body = ""
        if (hasFiles) {
          body = fileCount === 1 
            ? `${senderName} sent a file`
            : `${senderName} sent ${fileCount} files`
        } else if (truncatedText) {
          body = `${senderName}: ${truncatedText}`
        } else {
          body = `${senderName} sent a message`
        }

        const title = isGroup && conversationName 
          ? conversationName 
          : senderName

        return { title, body }
      } catch (error) {
        return {
          title: "New Message",
          body: "You have a new message",
        }
      }
    }

    default:
      // For future notification types, return undefined to use data-only notification
      // Or you can add more cases here
      return undefined
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

      try {
        // Convert all data values to strings for FCM (FCM requires all values to be strings)
        const fcmData: Record<string, string> = {}
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null) {
            fcmData[key] = typeof value === "string" ? value : JSON.stringify(value)
          }
        }

        // Generate notification payload based on type
        const notification = generateNotificationPayload(data as NotificationData)

        const message: admin.messaging.Message = {
          token,
          data: fcmData,
        }

        // Add notification if payload was generated
        if (notification) {
          message.notification = notification
        }

        const messageId = await admin.messaging().send(message)
        return { success: true, messageId }
      } catch (error: any) {
        console.error("Push error:", error)
        return { success: false, error: error?.message || "Failed to send push notification" }
      }
    }
  )
})

declare module "fastify" {
  interface FastifyInstance {
    sendDataPush: (
      token: string,
      data: Record<string, string>
    ) => Promise<{ success: boolean; messageId?: string; error?: string }>
  }
}
