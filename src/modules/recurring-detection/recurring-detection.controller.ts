import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  confirmRecurringSuggestionSchema,
  recurringRunSchema,
  recurringSuggestionIdSchema,
} from "./recurring-detection.schemas.js";
import { recurringDetectionWorkflow as workflow } from "./recurring-detection.workflow.js";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};

const asyncHandler =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

const monthsFromQuery = (value: unknown) => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : 12;
  return Number.isFinite(parsed) ? parsed : 12;
};

export const suggestions = asyncHandler(async (request, response) => {
  response.json({
    success: true,
    data: await workflow.run(
      request.workspace!.workspaceId,
      monthsFromQuery(request.query.months),
    ),
  });
});

export const run = asyncHandler(async (request, response) => {
  const input = parse(recurringRunSchema, request.body ?? {});
  response.json({
    success: true,
    data: await workflow.run(request.workspace!.workspaceId, input.months),
  });
});

export const dismiss = asyncHandler(async (request, response) => {
  const suggestionId = parse(recurringSuggestionIdSchema, request.params.suggestionId);
  response.json({
    success: true,
    data: await workflow.dismiss(request.workspace!.workspaceId, suggestionId),
  });
});

export const confirm = asyncHandler(async (request, response) => {
  const suggestionId = parse(recurringSuggestionIdSchema, request.params.suggestionId);
  const input = parse(confirmRecurringSuggestionSchema, request.body ?? {});
  response.status(201).json({
    success: true,
    data: await workflow.confirm(request.workspace!.workspaceId, suggestionId, input),
  });
});
