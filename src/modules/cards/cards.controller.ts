import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { cardPaymentSchema, purchaseSchema, statementSchema, uuid } from "./cards.schemas.js";
import { cardsService as s } from "./cards.service.js";
const p = <T>(z: ZodType<T>, v: unknown) => {
    const r = z.safeParse(v);
    if (!r.success) throw new ValidationError("Datos inválidos", r.error.issues);
    return r.data;
  },
  x =
    (h: (q: Request, r: Response) => Promise<unknown>) =>
    (q: Request, r: Response, n: NextFunction) => {
      void h(q, r).catch(n);
    };
export const list = x(async (q, r) =>
  r.json({ success: true, data: await s.list(q.workspace!.workspaceId) }),
);
export const purchases = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.purchases(q.workspace!.workspaceId, p(uuid, q.params.cardId)),
  }),
);
export const purchase = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.purchase(
      q.workspace!.workspaceId,
      q.auth!.userId,
      p(uuid, q.params.cardId),
      p(purchaseSchema, q.body),
    ),
  }),
);
export const statement = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.statement(
      q.workspace!.workspaceId,
      p(uuid, q.params.cardId),
      p(statementSchema, q.body),
    ),
  }),
);
export const statements = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.statements(q.workspace!.workspaceId, p(uuid, q.params.cardId)),
  }),
);
export const pay = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.pay(
      q.workspace!.workspaceId,
      q.auth!.userId,
      p(uuid, q.params.cardId),
      p(uuid, q.params.statementId),
      p(cardPaymentSchema, q.body),
    ),
  }),
);
