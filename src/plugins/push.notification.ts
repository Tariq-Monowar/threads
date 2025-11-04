import fp from "fastify-plugin"
import * as admin from "firebase-admin"

function initFirebase() {
  if (admin.apps.length) return true
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!sa) return false
  try {
    const creds = JSON.parse(sa)
    admin.initializeApp({
      credential: admin.credential.cert(creds as admin.ServiceAccount),
    })
    return true
  } catch {
    return false
  }
}

export default fp(async (fastify) => {
  const initialized = initFirebase()
  if (initialized) {
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
        throw new Error("Push notifications not configured")
      }
      return await admin.messaging().send({ token, data })
    }
  )
})

declare module "fastify" {
  interface FastifyInstance {
    sendDataPush: (token: string, data: Record<string, string>) => Promise<string>
  }
}
