import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../common/errors/app-error.js";
import { dashboardQuerySchema } from "./dashboard.schemas.js";
import { dashboardService } from "./dashboard.service.js";

export function getDashboard(request: Request, response: Response, next: NextFunction): void {
  const parsed = dashboardQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    next(new ValidationError("Parámetros de dashboard inválidos", parsed.error.issues));
    return;
  }
  void dashboardService
    .get(
      request.workspace!.workspaceId,
      request.workspace!.workspace.baseCurrency,
      request.workspace!.workspace.timezone,
      parsed.data,
    )
    .then((data) => response.status(200).json({ success: true, data }))
    .catch(next);
}
