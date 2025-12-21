import path from "path";
import Fastify from "fastify";
import AutoLoad from "@fastify/autoload";
import cors from "@fastify/cors";
import routesV1 from "./src/routes/v1";
import fastifyStatic from "@fastify/static";
import { registerMultipart } from "./src/config/storage.config";

const app = Fastify({ logger: true });

app.register(cors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

registerMultipart(app);

app.register(AutoLoad, {
  dir: path.join(__dirname, "src/plugins"),
});

app.register(routesV1, { prefix: "/api/v1" });

app.register(fastifyStatic, {
  root: path.join(__dirname, "uploads"),
  prefix: "/uploads/",
});

app.setNotFoundHandler((request, reply) => {
  reply.status(400).send({
    statusCode: 400,
    error: "Bad Request",
    message: "Route not found",
  });
});


app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  reply.status(500).send({
    statusCode: 500,
    error: error.message,
    message: "Internal Server Error",
  });
});

export default app;
