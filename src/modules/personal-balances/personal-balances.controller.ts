import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  createPersonalBalanceSchema,
  personalBalanceEntrySchema,
  updatePersonalBalanceSchema,
  uuid,
} from "./personal-balances.schemas.js";
import { personalBalancesService as service } from "./personal-balances.service.js";

const parse = <T>(schema: ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};
const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

export const list = asyncRoute(async (request, response) => {
  response.json({
    success: true,
    data: await service.list(request.workspace!.workspaceId, {
      direction: typeof request.query.direction === "string" ? request.query.direction : undefined,
      status: typeof request.query.status === "string" ? request.query.status : undefined,
      query: typeof request.query.q === "string" ? request.query.q : undefined,
    }),
  });
});

export const summary = asyncRoute(async (request, response) => {
  response.json({
    success: true,
    data: await service.summary(request.workspace!.workspaceId),
  });
});

export const get = asyncRoute(async (request, response) => {
  response.json({
    success: true,
    data: await service.get(
      request.workspace!.workspaceId,
      parse(uuid, request.params.personalBalanceId),
    ),
  });
});

export const create = asyncRoute(async (request, response) => {
  response.status(201).json({
    success: true,
    data: await service.create(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(createPersonalBalanceSchema, request.body),
    ),
  });
});

export const update = asyncRoute(async (request, response) => {
  response.json({
    success: true,
    data: await service.update(
      request.workspace!.workspaceId,
      parse(uuid, request.params.personalBalanceId),
      parse(updatePersonalBalanceSchema, request.body),
    ),
  });
});

export const addEntry = asyncRoute(async (request, response) => {
  response.status(201).json({
    success: true,
    data: await service.addEntry(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(uuid, request.params.personalBalanceId),
      parse(personalBalanceEntrySchema, request.body),
    ),
  });
});

export const settle = asyncRoute(async (request, response) => {
  response.json({
    success: true,
    data: await service.settle(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(uuid, request.params.personalBalanceId),
    ),
  });
});

export const archive = asyncRoute(async (request, response) => {
  response.json({
    success: true,
    data: await service.archive(
      request.workspace!.workspaceId,
      parse(uuid, request.params.personalBalanceId),
    ),
  });
});
