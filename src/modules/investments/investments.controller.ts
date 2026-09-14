import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { investmentsService as service } from "./investments.service.js";
import {
  createInvestmentPlanSchema,
  investmentContributionSchema,
  investmentPlanIdSchema,
  investmentPlanListSchema,
  investmentValuationSchema,
  investmentWithdrawalSchema,
  startInvestmentPlanSchema,
  updateInvestmentPlanSchema,
} from "./investments.schemas.js";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};

const route =
  (handler: (request: Request, response: Response) => Promise<unknown> | unknown) =>
  (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response)).catch(next);
  };

const workspace = (request: Request) => request.workspace!.workspaceId;
const planId = (request: Request) => parse(investmentPlanIdSchema, request.params.planId);

export const list = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.list(workspace(request), parse(investmentPlanListSchema, request.query)),
  }),
);

export const get = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.get(workspace(request), planId(request)),
  }),
);

export const create = route(async (request, response) =>
  response.status(201).json({
    success: true,
    data: await service.create(
      workspace(request),
      request.auth!.userId,
      parse(createInvestmentPlanSchema, request.body),
    ),
  }),
);

export const update = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.update(
      workspace(request),
      request.auth!.userId,
      planId(request),
      parse(updateInvestmentPlanSchema, request.body),
    ),
  }),
);

export const start = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.start(
      workspace(request),
      request.auth!.userId,
      planId(request),
      parse(startInvestmentPlanSchema, request.body),
    ),
  }),
);

export const pause = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.pause(workspace(request), request.auth!.userId, planId(request)),
  }),
);

export const resume = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.resume(workspace(request), request.auth!.userId, planId(request)),
  }),
);

export const complete = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.complete(workspace(request), request.auth!.userId, planId(request)),
  }),
);

export const archive = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.archive(workspace(request), request.auth!.userId, planId(request)),
  }),
);

export const contribute = route(async (request, response) =>
  response.status(201).json({
    success: true,
    data: await service.contribute(
      workspace(request),
      request.auth!.userId,
      planId(request),
      parse(investmentContributionSchema, request.body),
    ),
  }),
);

export const withdraw = route(async (request, response) =>
  response.status(201).json({
    success: true,
    data: await service.withdraw(
      workspace(request),
      request.auth!.userId,
      planId(request),
      parse(investmentWithdrawalSchema, request.body),
    ),
  }),
);

export const valuation = route(async (request, response) =>
  response.status(201).json({
    success: true,
    data: await service.addValuation(
      workspace(request),
      request.auth!.userId,
      planId(request),
      parse(investmentValuationSchema, request.body),
    ),
  }),
);

export const progress = route(async (request, response) =>
  response.json({
    success: true,
    data: await service.progress(workspace(request), planId(request)),
  }),
);
