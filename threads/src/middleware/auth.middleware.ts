import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

interface AuthenticatedRequest extends FastifyRequest {
  user?: any;
}

export const verifyUser = (...allowedRoles: string[]) => {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      reply.status(401).send({
        success: false,
        message: "No token provided",
      });
      return;
    }

    try {
      const token = authHeader;
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
      request.user = decoded;

      if (
        allowedRoles.length &&
        !allowedRoles.includes("ANY") &&
        !allowedRoles.includes(request.user?.type)
      ) {
        reply.status(403).send({
          success: false,
          message:
            "Access denied! you have no permission to access this resource",
        });
        return;
      }
    } catch (error) {
      reply.status(401).send({
        success: false,
        message: "Invalid or expired token",
      });
      return;
    }
  };
};
