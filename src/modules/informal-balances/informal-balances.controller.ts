import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  createInformalBalanceSchema,
  informalPaymentSchema,
  listInformalBalancesSchema,
  updateInformalBalanceSchema,
  uuid,
} from "./informal-balances.schemas.js";
import { informalBalancesService as service } from "./informal-balances.service.js";

const parse = <T>(schema: ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};
const asyncHandler =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

export const list = asyncHandler(async (request, response) =>
  response.json({
    success: true,
    data: await service.list(
      request.workspace!.workspaceId,
      parse(listInformalBalancesSchema, request.query),
    ),
  }),
);

export const summary = asyncHandler(async (request, response) =>
  response.json({ success: true, data: await service.summary(request.workspace!.workspaceId) }),
);

export const get = asyncHandler(async (request, response) =>
  response.json({
    success: true,
    data: await service.get(
      request.workspace!.workspaceId,
      parse(uuid, request.params.informalBalanceId),
    ),
  }),
);

export const create = asyncHandler(async (request, response) =>
  response.status(201).json({
    success: true,
    data: await service.create(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(createInformalBalanceSchema, request.body),
    ),
  }),
);

export const update = asyncHandler(async (request, response) =>
  response.json({
    success: true,
    data: await service.update(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(uuid, request.params.informalBalanceId),
      parse(updateInformalBalanceSchema, request.body),
    ),
  }),
);

export const archive = asyncHandler(async (request, response) =>
  response.json({
    success: true,
    data: await service.archive(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(uuid, request.params.informalBalanceId),
    ),
  }),
);

export const pay = asyncHandler(async (request, response) =>
  response.status(201).json({
    success: true,
    data: await service.pay(
      request.workspace!.workspaceId,
      request.auth!.userId,
      parse(uuid, request.params.informalBalanceId),
      parse(informalPaymentSchema, request.body),
    ),
  }),
);
