import fp from "fastify-plugin"
import * as admin from "firebase-admin"

function initFirebase() {
  if (admin.apps.length) return

  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!sa) {
    throw new Error("Set FIREBASE_SERVICE_ACCOUNT to your service account JSON string")
  }

  const creds = JSON.parse(sa)
  admin.initializeApp({
    credential: admin.credential.cert(creds as admin.ServiceAccount),
  })
}

export default fp(async (fastify) => {
  try {
    initFirebase()

    fastify.decorate(
      "sendDataPush",
      async (token: string, data: any) => {
        return await admin.messaging().send({ token, data })
      }
    )

    fastify.log.info("Push notifications ready")
  } catch (err) {
    fastify.log.error({ err }, "Push notifications init failed")
  }
})

declare module "fastify" {
  interface FastifyInstance {
    sendDataPush: (token: string, data: any) => Promise<string>
  }
}
