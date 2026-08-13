import { z } from "zod";
const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/),
  rate = z.string().regex(/^\d{1,3}(?:\.\d{1,7})?$/);
export const uuid = z.string().uuid();
export const purchaseSchema = z
  .object({
    amount: money,
    categoryId: uuid,
    occurredAt: z.string().datetime({ offset: true }),
    description: z.string().trim().min(1).max(250),
    installmentCount: z.number().int().min(1).max(120).default(1),
    periodicRate: rate.default("0"),
    firstDueDate: z.string().date(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export const statementSchema = z
  .object({
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    dueDate: z.string().date(),
    previousBalance: money.default("0"),
    interestAmount: money.default("0"),
    feeAmount: money.default("0"),
    minimumPayment: money.default("0"),
    reportedBalance: money.optional(),
  })
  .strict();
export const cardPaymentSchema = z
  .object({
    sourceAccountId: uuid,
    amount: money,
    occurredAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
