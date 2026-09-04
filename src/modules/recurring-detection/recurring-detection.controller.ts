import type { NextFunction, Request, Response } from "express";
import { recurringDetectionService as service } from "./recurring-detection.service.js";

const asyncHandler =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

export const suggestions = asyncHandler(async (request, response) => {
  const rawMonths = request.query.months;
  const parsedMonths =
    typeof rawMonths === "string" && rawMonths.trim() !== "" ? Number(rawMonths) : 12;

  const months = Number.isFinite(parsedMonths) ? parsedMonths : 12;
  response.json({
    success: true,
    data: await service.suggestions(request.workspace!.workspaceId, months),
  });
});
