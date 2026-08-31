import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { createLoanSchema, paymentSchema, simulationSchema, updateLoanSchema, uuid } from "./lending.schemas.js";
import { lendingService as service } from "./lending.service.js";

const parse = <T>(schema: ZodType<T>, value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};
const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => { void handler(request, response).catch(next); };

export const simulate = asyncRoute(async (req, res) => res.json({ success: true, data: service.simulate(parse(simulationSchema, req.body)) }));
export const summary = asyncRoute(async (req, res) => res.json({ success: true, data: await service.summary(req.workspace!.workspaceId) }));
export const list = asyncRoute(async (req, res) => res.json({ success: true, data: await service.list(req.workspace!.workspaceId, typeof req.query.q === "string" ? req.query.q : undefined) }));
export const get = asyncRoute(async (req, res) => res.json({ success: true, data: await service.get(req.workspace!.workspaceId, parse(uuid, req.params.loanId)) }));
export const create = asyncRoute(async (req, res) => res.status(201).json({ success: true, data: await service.create(req.workspace!.workspaceId, req.auth!.userId, parse(createLoanSchema, req.body)) }));
export const update = asyncRoute(async (req, res) => res.json({ success: true, data: await service.update(req.workspace!.workspaceId, parse(uuid, req.params.loanId), parse(updateLoanSchema, req.body)) }));
export const pay = asyncRoute(async (req, res) => res.status(201).json({ success: true, data: await service.pay(req.workspace!.workspaceId, req.auth!.userId, parse(uuid, req.params.loanId), parse(uuid, req.params.installmentId), parse(paymentSchema, req.body)) }));
export const archive = asyncRoute(async (req, res) => res.json({ success: true, data: await service.archive(req.workspace!.workspaceId, parse(uuid, req.params.loanId)) }));
