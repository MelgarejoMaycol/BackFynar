import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { lendingService as service } from "./lending.service.js";
import { createLoanSchema, listLoansSchema, paymentSchema, reversePaymentSchema, simulationSchema, updateLoanSchema, uuid } from "./lending.schemas.js";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};
const route = (handler: (request: Request, response: Response) => Promise<unknown> | unknown) =>
  (request: Request, response: Response, next: NextFunction) => { Promise.resolve(handler(request, response)).catch(next); };
const workspace = (request: Request) => request.workspace!.workspaceId;

export const simulate = route((request, response) => response.json({ success: true, data: service.simulate(parse(simulationSchema, request.body)) }));
export const summary = route(async (request, response) => response.json({ success: true, data: await service.summary(workspace(request)) }));
export const list = route(async (request, response) => response.json({ success: true, data: await service.list(workspace(request), parse(listLoansSchema, request.query)) }));
export const get = route(async (request, response) => response.json({ success: true, data: await service.get(workspace(request), parse(uuid, request.params.loanId)) }));
export const create = route(async (request, response) => response.status(201).json({ success: true, data: await service.create(workspace(request), request.auth!.userId, parse(createLoanSchema, request.body)) }));
export const update = route(async (request, response) => response.json({ success: true, data: await service.update(workspace(request), request.auth!.userId, parse(uuid, request.params.loanId), parse(updateLoanSchema, request.body)) }));
export const pay = route(async (request, response) => response.status(201).json({ success: true, data: await service.pay(workspace(request), request.auth!.userId, parse(uuid, request.params.loanId), parse(uuid, request.params.installmentId), parse(paymentSchema, request.body)) }));
export const reverse = route(async (request, response) => response.json({ success: true, data: await service.reverse(workspace(request), request.auth!.userId, parse(uuid, request.params.loanId), parse(uuid, request.params.paymentId), parse(reversePaymentSchema, request.body).reason) }));
export const archive = route(async (request, response) => response.json({ success: true, data: await service.archive(workspace(request), request.auth!.userId, parse(uuid, request.params.loanId)) }));
