import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  createPersonalBalanceSchema,
  personalBalanceEntrySchema,
  updatePersonalBalanceSchema,
  createPersonSchema,
  updatePersonSchema,
  uuid,
} from "./personal-balances.schemas.js";
import { personalBalancesService as service } from "./personal-balances.service.js";
import { personalBalanceSourceAccountService } from "./personal-balances.source-account.js";

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
  const filters: { direction?: string; status?: string; query?: string } = {};
  if (typeof request.query.direction === "string") filters.direction = request.query.direction;
  if (typeof request.query.status === "string") filters.status = request.query.status;
  if (typeof request.query.q === "string") filters.query = request.query.q;

  response.json({
    success: true,
    data: await service.list(request.workspace!.workspaceId, filters),
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
  const input = parse(createPersonalBalanceSchema, request.body);
  const created = await service.create(
    request.workspace!.workspaceId,
    request.auth!.userId,
    input,
  );
  if (input.direction === "RECEIVABLE" && input.sourceAccountId) {
    await personalBalanceSourceAccountService.link(
      request.workspace!.workspaceId,
      request.auth!.userId,
      created.id,
      input.sourceAccountId,
    );
  }
  response.status(201).json({
    success: true,
    data: await service.get(request.workspace!.workspaceId, created.id),
  });
});

export const update = asyncRoute(async (request, response) => {
  const personalBalanceId = parse(uuid, request.params.personalBalanceId);
  const input = parse(updatePersonalBalanceSchema, request.body);
  const updated = await service.update(
    request.workspace!.workspaceId,
    personalBalanceId,
    input,
  );
  if (input.sourceAccountId) {
    await personalBalanceSourceAccountService.link(
      request.workspace!.workspaceId,
      request.auth!.userId,
      personalBalanceId,
      input.sourceAccountId,
    );
  }
  response.json({
    success: true,
    data: input.sourceAccountId
      ? await service.get(request.workspace!.workspaceId, personalBalanceId)
      : updated,
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
      parse(uuid, request.body.accountId),
    ),
  });
});

export const reverseEntry = asyncRoute(async (request, response) => {
  response.json({ success: true, data: await service.reverseEntry(
    request.workspace!.workspaceId,
    request.auth!.userId,
    parse(uuid, request.params.personalBalanceId),
    parse(uuid, request.params.entryId),
  ) });
});

export const listPeople = asyncRoute(async (request, response) => {
  response.json({ success: true, data: await service.listPeople(
    request.workspace!.workspaceId,
    typeof request.query.q === "string" ? request.query.q : undefined,
  ) });
});
export const createPerson = asyncRoute(async (request, response) => {
  response.status(201).json({ success: true, data: await service.createPerson(
    request.workspace!.workspaceId, request.auth!.userId, parse(createPersonSchema, request.body),
  ) });
});
export const updatePerson = asyncRoute(async (request, response) => {
  response.json({ success: true, data: await service.updatePerson(
    request.workspace!.workspaceId, parse(uuid, request.params.personId), parse(updatePersonSchema, request.body),
  ) });
});
export const archivePerson = asyncRoute(async (request, response) => {
  response.json({ success: true, data: await service.archivePerson(
    request.workspace!.workspaceId, parse(uuid, request.params.personId),
  ) });
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
