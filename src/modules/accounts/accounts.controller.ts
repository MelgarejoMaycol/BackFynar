import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { accountsService } from "./accounts.service.js";
import {
  accountIdSchema,
  createAccountSchema,
  favoriteAccountSchema,
  listAccountsSchema,
  updateAccountSchema,
} from "./accounts.schemas.js";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos invalidos", result.error.issues);
  return result.data;
};
const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
const accountId = (request: Request) => parse(accountIdSchema, request.params.accountId);

export const create = execute(async (request, response) => {
  response.status(201).json({
    success: true,
    data: await accountsService.create(
      request.workspace!.workspaceId,
      parse(createAccountSchema, request.body),
    ),
  });
});
export const list = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await accountsService.list(
      request.workspace!.workspaceId,
      parse(listAccountsSchema, request.query),
    ),
  });
});
export const get = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await accountsService.get(request.workspace!.workspaceId, accountId(request)),
  });
});
export const update = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await accountsService.update(
      request.workspace!.workspaceId,
      accountId(request),
      parse(updateAccountSchema, request.body),
    ),
  });
});
export const favorite = execute(async (request, response) => {
  const input = parse(favoriteAccountSchema, request.body);
  response.status(200).json({
    success: true,
    data: await accountsService.favorite(
      request.workspace!.workspaceId,
      accountId(request),
      input.isFavorite,
    ),
  });
});
export const archive = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await accountsService.archive(request.workspace!.workspaceId, accountId(request)),
  });
});
export const restore = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await accountsService.restore(request.workspace!.workspaceId, accountId(request)),
  });
});
export const remove = execute(async (request, response) => {
  await accountsService.remove(request.workspace!.workspaceId, accountId(request));
  response.status(204).send();
});
