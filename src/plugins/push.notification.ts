import fp from "fastify-plugin"
import * as admin from "firebase-admin"

function initFirebase(): boolean {
  if (admin.apps.length) {
    return true
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!serviceAccountJson) {
    return false
  }

  try {
    const credentials = JSON.parse(serviceAccountJson)
    admin.initializeApp({
      credential: admin.credential.cert(credentials as admin.ServiceAccount),
    })
    return true
  } catch {
    return false
  }
}

export default fp(async (fastify) => {
  const isInitialized = initFirebase()

  if (isInitialized) {
    fastify.log.info("Push notifications ready")
  } else {
    fastify.log.warn(
      "Push notifications not configured: set FIREBASE_SERVICE_ACCOUNT JSON"
    )
  }

  fastify.decorate(
    "sendDataPush",
    async (token: string, data: Record<string, string>) => {
      if (!admin.apps.length) {
        return { success: false, error: "Push notifications not configured" }
      }

      try {
        const messageId = await admin.messaging().send({ token, data })
        return { success: true, messageId }
      } catch (error: any) {
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
