import { FastifyInstance } from "fastify";

import auth from "./auth/auth.routes";
import conversation from "./conversation/conversation.routes";
import messages from "./messages/messages.routes";
import calls from "./calls/calls.routes";
import block from "./block/block.routes";

import privateRoutes from "./conversation/private/private.routes";
import groupRoutes from "./conversation/group/group.routes";


async function routesV1(fastify: FastifyInstance) {
  const moduleRoutes = [
    { path: "/auth", route: auth },
    { path: "/conversation", route: conversation },
    { path: "/messages", route: messages },
    { path: "/calls", route: calls },
    { path: "/block", route: block },
    { path: "/conversation/groups", route: groupRoutes },
    { path: "/conversation/private", route: privateRoutes },
  ];

  moduleRoutes.forEach(({ path, route }) => {
    fastify.register(route, { prefix: path });
  });
}

export default routesV1;
