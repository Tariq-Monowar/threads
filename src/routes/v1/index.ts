import { FastifyInstance } from "fastify";

import auth from "./auth/auth.routes";
import conversation from "./conversation/conversation.routes"

async function routesV1(fastify: FastifyInstance) {
  const moduleRoutes = [
    { path: "/auth", route: auth },
    { path: "/conversation", route: conversation}
  ];

  moduleRoutes.forEach(({ path, route }) => {
    fastify.register(route, { prefix: path });
  });
}

export default routesV1;
