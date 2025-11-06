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

      console.log("================================================", data);

      try {
        const messageId = await admin.messaging().send({
          token,
          data: {
            body: data as any || "You have a new message!",
          },
        })
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
