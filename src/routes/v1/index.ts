import { FastifyInstance } from "fastify";

import auth from "./auth/auth.routes";
import conversation from "./conversation/conversation.routes";
import messages from "./messages/messages.routes";

import privateRoutes from "./conversation/private/private.routes";
import grupRoutes from "./conversation/group/group.routes";
import notifications from "./notifications/notifications.routes";

async function routesV1(fastify: FastifyInstance) {
  const moduleRoutes = [
    { path: "/auth", route: auth },
    { path: "/conversation", route: conversation },
    { path: "/messages", route: messages },
    { path: "/conversation/grups", route: grupRoutes },
    { path: "/conversation/private", route: privateRoutes },
    { path: "/notifications", route: notifications },
  ];

  moduleRoutes.forEach(({ path, route }) => {
    fastify.register(route, { prefix: path });
  });
}

export default routesV1;
