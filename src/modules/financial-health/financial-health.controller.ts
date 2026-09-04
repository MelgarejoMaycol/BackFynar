import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../common/errors/app-error.js";
import { financialHealthHistoryQuerySchema } from "./financial-health.schemas.js";
import { financialHealthService } from "./financial-health.service.js";

const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };

export const current = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await financialHealthService.current(
      request.workspace!.workspaceId,
      request.workspace!.workspace.baseCurrency,
      request.workspace!.workspace.timezone,
      new Date(),
    ),
  });
});

export const history = execute(async (request, response) => {
  const parsed = financialHealthHistoryQuerySchema.safeParse(request.query);
  if (!parsed.success)
    throw new ValidationError("Consulta de salud financiera inválida", parsed.error.issues);
  response.status(200).json({
    success: true,
    data: await financialHealthService.history(
      request.workspace!.workspaceId,
      parsed.data.limit,
    ),
  });
});
