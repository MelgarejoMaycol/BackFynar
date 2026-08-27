import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  cardPaymentSchema,
  cardPaymentExpectationSchema,
  cashAdvanceSchema,
  createCardSchema,
  purchaseSchema,
  statementSchema,
  updateCardSchema,
  uuid,
} from "./cards.schemas.js";
import { cardsService as s } from "./cards.service.js";
import { logger } from "../../common/logging/logger.js";
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
export const create = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.create(q.workspace!.workspaceId, p(createCardSchema, q.body)),
  }),
);
export const update = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.update(
      q.workspace!.workspaceId,
      p(uuid, q.params.cardId),
      p(updateCardSchema, q.body),
    ),
  }),
);
export const remove = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.remove(q.workspace!.workspaceId, q.auth!.userId, p(uuid, q.params.cardId)),
  }),
);
export const cashAdvance = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.cashAdvance(
      q.workspace!.workspaceId,
      q.auth!.userId,
      p(uuid, q.params.cardId),
      p(cashAdvanceSchema, q.body),
    ),
  }),
);
export const purchases = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.purchases(q.workspace!.workspaceId, p(uuid, q.params.cardId)),
  }),
);
export const activity = x(async (q, r) =>
  r.json({
    success: true,
    data: await s.activity(q.workspace!.workspaceId, p(uuid, q.params.cardId)),
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
export const nextPayment = x(async (q, r) =>
  r.status(201).json({
    success: true,
    data: await s.setNextPayment(
      q.workspace!.workspaceId,
      q.auth!.userId,
      p(uuid, q.params.cardId),
      p(cardPaymentExpectationSchema, q.body),
    ),
  }),
);
export const pay = x(async (q, r) => {
  const cardId = p(uuid, q.params.cardId);
  const data = await s.pay(
    q.workspace!.workspaceId,
    q.auth!.userId,
    cardId,
    p(uuid, q.params.statementId),
    p(cardPaymentSchema, q.body),
  );
  logger.info("Pago de tarjeta aplicado", {
    requestId: q.requestId,
    workspaceId: q.workspace!.workspaceId,
    cardId,
    operationType: "CARD_PAYMENT",
    status: "SUCCESS",
  });
  return r.status(201).json({
    success: true,
    data,
  });
});
export const payBalance = x(async (q, r) => {
  const cardId = p(uuid, q.params.cardId);
  const data = await s.payBalance(
    q.workspace!.workspaceId,
    q.auth!.userId,
    cardId,
    p(cardPaymentSchema, q.body),
  );
  logger.info("Pago de tarjeta aplicado", {
    requestId: q.requestId,
    workspaceId: q.workspace!.workspaceId,
    cardId,
    operationType: "CARD_PAYMENT",
    status: "SUCCESS",
  });
  return r.status(201).json({
    success: true,
    data,
  });
});
