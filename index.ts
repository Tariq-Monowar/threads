import 'dotenv/config'
import app from "./app"

async function start() {
  try {
    const port = Number(process.env.PORT) || 4002
    await app.listen({ port, host: "0.0.0.0" })
    console.log(`Server running at http://localhost:${port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
