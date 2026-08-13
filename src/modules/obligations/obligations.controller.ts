import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  createObligationSchema,
  occurrencePaymentSchema,
  occurrenceSchema,
  updateObligationSchema,
  uuid,
} from "./obligations.schemas.js";
import { obligationsService as s } from "./obligations.service.js";
const p = <T>(z: ZodType<T>, v: unknown) => {
  const r = z.safeParse(v);
  if (!r.success) throw new ValidationError("Datos inválidos", r.error.issues);
  return r.data;
};
const x =
  (h: (q: Request, r: Response) => Promise<unknown>) =>
  (q: Request, r: Response, n: NextFunction) => {
    void h(q, r).catch(n);
  };
export const create = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.create(q.workspace!.workspaceId, p(createObligationSchema, q.body)),
  }),
);
export const list = x(async (q, r) =>
  r.json({ success: true, data: await s.list(q.workspace!.workspaceId) }),
);
export const get = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.get(q.workspace!.workspaceId, p(uuid, q.params.obligationId)),
  }),
);
export const update = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.update(
      q.workspace!.workspaceId,
      p(uuid, q.params.obligationId),
      p(updateObligationSchema, q.body),
    ),
  }),
);
export const archive = x(async (q, r) => {
  await s.archive(q.workspace!.workspaceId, p(uuid, q.params.obligationId));
  r.status(204).send();
});
export const occurrence = x(async (q, r) => {
  const i = p(occurrenceSchema, q.body);
  r.status(201).json({
    success: true,
    data: await s.occurrence(
      q.workspace!.workspaceId,
      p(uuid, q.params.obligationId),
      i.dueDate,
      i.amount,
    ),
  });
});
export const pay = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.pay(
      q.workspace!.workspaceId,
      q.auth!.userId,
      p(uuid, q.params.obligationId),
      p(uuid, q.params.occurrenceId),
      p(occurrencePaymentSchema, q.body),
    ),
  }),
);
