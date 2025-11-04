import { FastifyInstance } from "fastify"

const notificationsRoutes = (fastify: FastifyInstance) => {
  fastify.post("/send-notification", async (request, reply) => {
    try {
      const { token, data } = request.body as {
        token?: string
        data?: Record<string, string>
      }

      if (!token || !data || Object.keys(data).length === 0) {
        return reply.status(400).send({
          success: false,
          error: "token and non-empty data are required",
        })
      }

      const response = await request.server.sendDataPush(token, data)

      return reply.status(200).send({ success: true, response })
    } catch (error: any) {
      request.log.error({ err: error }, "Error sending message")
      return reply
        .status(500)
        .send({ success: false, error: error?.message || "Unknown error" })
    }
  })
}

export default notificationsRoutes
