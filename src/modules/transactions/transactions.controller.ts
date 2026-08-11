import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { transactionsService } from "./transactions.service.js";
import {
  cancelTransactionSchema,
  adjustmentSchema,
  expenseSchema,
  incomeSchema,
  listTransactionsSchema,
  transactionIdSchema,
  transferSchema,
  updateTransactionSchema,
} from "./transactions.schemas.js";
const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};
const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
const id = (request: Request) => parse(transactionIdSchema, request.params.transactionId);
export const list = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await transactionsService.list(
      req.workspace!.workspaceId,
      parse(listTransactionsSchema, req.query),
    ),
  });
});
export const get = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await transactionsService.get(req.workspace!.workspaceId, id(req)),
  });
});
export const income = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await transactionsService.income(
      req.workspace!.workspaceId,
      req.auth!.userId,
      parse(incomeSchema, req.body),
    ),
  });
});
export const expense = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await transactionsService.expense(
      req.workspace!.workspaceId,
      req.auth!.userId,
      parse(expenseSchema, req.body),
    ),
  });
});
export const transfer = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await transactionsService.transfer(
      req.workspace!.workspaceId,
      req.auth!.userId,
      parse(transferSchema, req.body),
    ),
  });
});
export const adjustment = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await transactionsService.adjustment(
      req.workspace!.workspaceId,
      req.auth!.userId,
      parse(adjustmentSchema, req.body),
    ),
  });
});
export const update = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await transactionsService.update(
      req.workspace!.workspaceId,
      id(req),
      parse(updateTransactionSchema, req.body),
    ),
  });
});
export const cancel = execute(async (req, res) => {
  await transactionsService.cancel(
    req.workspace!.workspaceId,
    id(req),
    parse(cancelTransactionSchema, req.body).version,
  );
  res.status(204).send();
});
