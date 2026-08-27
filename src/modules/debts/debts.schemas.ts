import {
  debt_payment_frequency,
  debt_status,
  debt_type,
  interest_rate_basis,
  interest_type,
} from "@prisma/client";
import { z } from "zod";

const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/, "Formato monetario inválido");
const positiveMoney = money.refine(
  (value) => BigInt(value.replace(".", "").padEnd(value.includes(".") ? 0 : 2, "0")) > 0n,
  "El monto debe ser mayor que cero",
);
const rate = z
  .string()
  .regex(/^\d{1,3}(?:\.\d{1,7})?$/, "Formato de tasa inválido")
  .refine((value) => Number(value) <= 1, "La tasa debe estar entre 0 y 1 internamente");
const date = z.string().date();
export const id = z.string().uuid();
export const estimateDebtSchema = z
  .object({
    originalPrincipal: positiveMoney.optional(),
    currentBalance: positiveMoney.optional(),
    paymentAmount: positiveMoney.optional(),
    periodicRate: rate.optional(),
    interestRate: rate.optional(),
    interestRateBasis: z.nativeEnum(interest_rate_basis).optional(),
    paymentFrequency: z.nativeEnum(debt_payment_frequency).optional(),
    totalInstallments: z
      .number()
      .int()
      .positive()
      .max(600, "El número de cuotas debe estar entre 1 y 600")
      .optional(),
    installmentsPaid: z.number().int().min(0).max(600).optional(),
    remainingInstallments: z
      .number()
      .int()
      .positive("El número de cuotas debe estar entre 1 y 600")
      .max(600, "El número de cuotas debe estar entre 1 y 600")
      .optional(),
    disbursementDate: date.optional(),
    firstPaymentDate: date.optional(),
    currentDate: date.optional(),
    estimatedEndDate: date.optional(),
  })
  .strict();

const debtPayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    lenderName: z.string().trim().max(150).nullable().optional(),
    type: z.nativeEnum(debt_type),
    currency: z.string().regex(/^[A-Z]{3}$/),
    originalAmount: positiveMoney,
    currentBalance: positiveMoney.optional(),
    interestRate: rate.optional(),
    interestRateBasis: z.nativeEnum(interest_rate_basis).optional(),
    interestType: z.nativeEnum(interest_type).optional(),
    termMonths: z
      .number()
      .int()
      .positive()
      .max(600, "El plazo debe estar entre 1 y 600")
      .nullable()
      .optional(),
    installmentCount: z
      .number()
      .int()
      .positive("El número de cuotas debe estar entre 1 y 600")
      .max(600, "El número de cuotas debe estar entre 1 y 600")
      .nullable()
      .optional(),
    paymentFrequency: z.nativeEnum(debt_payment_frequency).optional(),
    installmentAmount: money.nullable().optional(),
    disbursementDate: date.nullable().optional(),
    firstPaymentDate: date.nullable().optional(),
    paymentDay: z.number().int().min(1).max(31).nullable().optional(),
    liabilityAccountId: id.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();

export const createDebtSchema = debtPayloadSchema
  .refine((value) => !(value.termMonths && value.installmentCount), {
    message: "Envía número de cuotas o plazo heredado, no ambos",
    path: ["installmentCount"],
  })
  .refine(
    (value) =>
      !value.currentBalance || Number(value.currentBalance) <= Number(value.originalAmount),
    {
      message: "El saldo pendiente no puede ser mayor al monto original",
      path: ["currentBalance"],
    },
  );
export const updateDebtSchema = debtPayloadSchema
  .partial()
  .extend({ status: z.nativeEnum(debt_status).optional() })
  .refine((x) => Object.keys(x).length > 0);
export const listDebtsSchema = z
  .object({
    status: z.nativeEnum(debt_status).optional(),
    type: z.nativeEnum(debt_type).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    search: z.string().trim().max(150).optional(),
    sort: z.enum(["createdAt", "nextDueDate", "currentBalance", "name"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const installmentUpdateSchema = z
  .object({ amount: money, recalculateFuture: z.boolean().default(false) })
  .strict();
export const paymentSchema = z
  .object({
    accountId: id.optional(),
    amount: positiveMoney,
    paidAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().min(8).max(100),
    principalAmount: money.optional(),
    interestAmount: money.optional(),
    insuranceAmount: money.optional(),
    feeAmount: money.optional(),
    extraPaymentAmount: money.optional(),
    strategy: z.enum(["REDUCE_TERM", "REDUCE_PAYMENT"]).optional(),
  })
  .strict();
export const reversePaymentSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const prepaymentSchema = z
  .object({
    accountId: id.optional(),
    amount: positiveMoney,
    strategy: z.enum(["REDUCE_TERM", "REDUCE_PAYMENT"]),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .strict();
export const reconciliationSchema = z
  .object({
    reportedBalance: money,
    effectiveDate: date,
    source: z.string().trim().min(1).max(100),
    notes: z.string().max(5000).optional(),
    newRate: rate.optional(),
    newPayment: money.optional(),
  })
  .strict();
export type CreateDebtInput = z.infer<typeof createDebtSchema>;
export type EstimateDebtInput = z.infer<typeof estimateDebtSchema>;
export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;
export type ListDebtsInput = z.infer<typeof listDebtsSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type PrepaymentInput = z.infer<typeof prepaymentSchema>;
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
