import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  budgetIdSchema,
  createBudgetSchema,
  listBudgetsSchema,
  updateBudgetSchema,
} from "./budgets.schemas.js";
import { budgetsService } from "./budgets.service.js";
const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ValidationError("Datos de presupuesto inválidos", result.error.issues);
  return result.data;
};
const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
const id = (request: Request) => parse(budgetIdSchema, request.params.budgetId);
export const list = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await budgetsService.list(
      req.workspace!.workspaceId,
      req.workspace!.workspace.timezone,
      parse(listBudgetsSchema, req.query),
    ),
  });
});
export const get = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await budgetsService.get(
      req.workspace!.workspaceId,
      id(req),
      req.workspace!.workspace.timezone,
    ),
  });
});
export const create = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await budgetsService.create(
      req.workspace!.workspaceId,
      req.workspace!.workspace.timezone,
      parse(createBudgetSchema, req.body),
    ),
  });
});
export const update = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await budgetsService.update(
      req.workspace!.workspaceId,
      id(req),
      req.workspace!.workspace.timezone,
      parse(updateBudgetSchema, req.body),
    ),
  });
});
export const archive = execute(async (req, res) => {
  await budgetsService.archive(req.workspace!.workspaceId, id(req));
  res.status(204).send();
});
export const restore = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await budgetsService.restore(
      req.workspace!.workspaceId,
      id(req),
      req.workspace!.workspace.timezone,
    ),
  });
});
