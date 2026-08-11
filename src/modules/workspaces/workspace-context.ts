import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "../../common/errors/app-error.js";
import { resolveMembership } from "./workspaces.repository.js";

export async function resolveWorkspaceContext(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!request.auth) throw new UnauthorizedError();
    const parsed = z.string().uuid().safeParse(request.params.workspaceId);
    if (!parsed.success) throw new ValidationError("workspaceId invalido", parsed.error.issues);
    request.workspace = await resolveMembership(request.auth.userId, parsed.data);
    next();
  } catch (error: unknown) {
    next(error);
  }
}

export const requirePermission =
  (permission: string) =>
  (request: Request, _response: Response, next: NextFunction): void => {
    try {
      if (!request.auth) throw new UnauthorizedError();
      if (!request.workspace)
        throw new UnauthorizedError("Contexto de workspace ausente", "Autenticacion requerida");
      if (!request.workspace.permissions.includes(permission))
        throw new ForbiddenError(`Permiso requerido: ${permission}`, "Permiso insuficiente");
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
