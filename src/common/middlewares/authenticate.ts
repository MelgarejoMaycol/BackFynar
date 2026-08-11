import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../errors/app-error.js";
import { verifyAccessToken } from "../../modules/auth/auth-token.service.js";
import { prisma } from "../../database/prisma.js";

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authorization = request.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedError();
    const claims = await verifyAccessToken(authorization.slice(7));
    const session = await prisma.refreshToken.findFirst({
      where: {
        id: claims.sessionId,
        userId: claims.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        users: { isActive: true, deletedAt: null },
      },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedError("Sesion revocada", "Sesion invalida o expirada");
    request.auth = claims;
    next();
  } catch (error: unknown) {
    next(error);
  }
}
