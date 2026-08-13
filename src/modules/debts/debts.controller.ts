import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { debtsService } from "./debts.service.js";
import {
  createDebtSchema,
  estimateDebtSchema,
  id,
  installmentUpdateSchema,
  listDebtsSchema,
  paymentSchema,
  prepaymentSchema,
  reconciliationSchema,
  reversePaymentSchema,
  updateDebtSchema,
} from "./debts.schemas.js";
import { estimateCredit } from "./domain/credit-estimator.js";
import type { CreditEstimationInput } from "./domain/credit-estimation.types.js";
const p = <T>(s: ZodType<T>, v: unknown) => {
  const r = s.safeParse(v);
  if (!r.success) throw new ValidationError("Datos inválidos", r.error.issues);
  return r.data;
};
const x =
  (h: (q: Request, r: Response) => Promise<void>) => (q: Request, r: Response, n: NextFunction) => {
    void h(q, r).catch(n);
  };
const ids = (q: Request) => ({
  debtId: p(id, q.params.debtId),
  installmentId: q.params.installmentId ? p(id, q.params.installmentId) : "",
  paymentId: q.params.paymentId ? p(id, q.params.paymentId) : "",
});
const estimationJson = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item instanceof Date) return item.toISOString();
      if (
        item &&
        typeof item === "object" &&
        "toFixed" in item &&
        typeof item.toFixed === "function"
      )
        return item.toString();
      return item;
    }),
  );
export const estimate = x(async (q, r) => {
  const input = p(estimateDebtSchema, q.body);
  const estimationInput: CreditEstimationInput = {
    ...(input.originalPrincipal ? { originalPrincipal: input.originalPrincipal } : {}),
    ...(input.currentBalance ? { currentBalance: input.currentBalance } : {}),
    ...(input.paymentAmount ? { paymentAmount: input.paymentAmount } : {}),
    ...(input.periodicRate ? { periodicRate: input.periodicRate } : {}),
    ...(input.interestRate ? { interestRate: input.interestRate } : {}),
    ...(input.interestRateBasis ? { interestRateBasis: input.interestRateBasis } : {}),
    ...(input.totalInstallments ? { totalInstallments: input.totalInstallments } : {}),
    ...(input.installmentsPaid !== undefined ? { installmentsPaid: input.installmentsPaid } : {}),
    ...(input.remainingInstallments !== undefined
      ? { remainingInstallments: input.remainingInstallments }
      : {}),
    ...(input.disbursementDate
      ? { disbursementDate: new Date(`${input.disbursementDate}T00:00:00Z`) }
      : {}),
    ...(input.firstPaymentDate
      ? { firstPaymentDate: new Date(`${input.firstPaymentDate}T00:00:00Z`) }
      : {}),
    ...(input.currentDate ? { currentDate: new Date(`${input.currentDate}T00:00:00Z`) } : {}),
    ...(input.estimatedEndDate
      ? { estimatedEndDate: new Date(`${input.estimatedEndDate}T00:00:00Z`) }
      : {}),
  };
  r.json({
    success: true,
    data: estimationJson(estimateCredit(estimationInput)),
  });
});
export const create = x(async (q, r) => {
  r.status(201).json({
    success: true,
    data: await debtsService.create(
      q.workspace!.workspaceId,
      q.auth!.userId,
      p(createDebtSchema, q.body),
    ),
  });
});
export const list = x(async (q, r) => {
  r.json({
    success: true,
    data: await debtsService.list(q.workspace!.workspaceId, p(listDebtsSchema, q.query)),
  });
});
export const get = x(async (q, r) => {
  r.json({ success: true, data: await debtsService.get(q.workspace!.workspaceId, ids(q).debtId) });
});
export const update = x(async (q, r) => {
  r.json({
    success: true,
    data: await debtsService.update(
      q.workspace!.workspaceId,
      q.auth!.userId,
      ids(q).debtId,
      p(updateDebtSchema, q.body),
    ),
  });
});
export const archive = x(async (q, r) => {
  await debtsService.archive(q.workspace!.workspaceId, q.auth!.userId, ids(q).debtId);
  r.status(204).send();
});
export const installment = x(async (q, r) => {
  const i = p(installmentUpdateSchema, q.body),
    v = ids(q);
  await debtsService.updateInstallment(
    q.workspace!.workspaceId,
    q.auth!.userId,
    v.debtId,
    v.installmentId,
    i.amount,
    i.recalculateFuture,
  );
  r.json({ success: true });
});
export const pay = x(async (q, r) => {
  const v = ids(q);
  r.status(201).json({
    success: true,
    data: await debtsService.pay(
      q.workspace!.workspaceId,
      q.auth!.userId,
      v.debtId,
      v.installmentId,
      p(paymentSchema, q.body),
    ),
  });
});
export const reverse = x(async (q, r) => {
  const v = ids(q);
  await debtsService.reverse(
    q.workspace!.workspaceId,
    q.auth!.userId,
    v.debtId,
    v.paymentId,
    p(reversePaymentSchema, q.body).reason,
  );
  r.json({ success: true });
});
export const simulate = x(async (q, r) => {
  r.json({
    success: true,
    data: await debtsService.simulatePrepayment(
      q.workspace!.workspaceId,
      ids(q).debtId,
      p(prepaymentSchema, q.body),
    ),
  });
});
export const applyPrepayment = x(async (q, r) => {
  r.status(201).json({
    success: true,
    data: await debtsService.applyPrepayment(
      q.workspace!.workspaceId,
      q.auth!.userId,
      ids(q).debtId,
      p(prepaymentSchema, q.body),
    ),
  });
});
export const reconcile = x(async (q, r) => {
  r.status(201).json({
    success: true,
    data: await debtsService.reconcile(
      q.workspace!.workspaceId,
      q.auth!.userId,
      ids(q).debtId,
      p(reconciliationSchema, q.body),
    ),
  });
});
