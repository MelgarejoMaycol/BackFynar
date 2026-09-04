import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { recurringDetectionService as service } from "./recurring-detection.service.js";

const asyncHandler =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

const monthsFromQuery = (value: unknown) => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : 12;
  return Number.isFinite(parsed) ? parsed : 12;
};

const confirmSchema = z
  .object({
    fingerprint: z.string().trim().min(3).max(500),
    months: z.number().int().min(3).max(24).optional(),
  })
  .strict();

export const suggestions = asyncHandler(async (request, response) => {
  response.json({
    success: true,
    data: await service.suggestions(
      request.workspace!.workspaceId,
      monthsFromQuery(request.query.months),
    ),
  });
});

export const confirm = asyncHandler(async (request, response) => {
  const parsed = confirmSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError("Datos inválidos", parsed.error.issues);

  response.status(201).json({
    success: true,
    data: await service.confirm(
      request.workspace!.workspaceId,
      parsed.data.fingerprint,
      parsed.data.months ?? 12,
    ),
  });
});
