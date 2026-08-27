import { transaction_status, transaction_type } from "@prisma/client";
import { z } from "zod";

export const transactionMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  .refine((value) => value !== "0" && !/^0\.0{1,2}$/.test(value), "Debe ser mayor que cero");
const cents = (value: string): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(2, "0")}`);
};
const text = (max: number) => z.union([z.string().trim().min(1).max(max), z.null()]).optional();
const common = {
  accountId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amount: transactionMoneySchema,
  occurredAt: z.iso.datetime({ offset: true }),
  description: text(250),
  notes: text(5_000),
  merchantName: text(150),
};
const cardPurchaseDetails = z
  .object({
    installmentCount: z.number().int().min(1).max(120).default(1),
    periodicRate: z
      .string()
      .regex(/^\d{1,3}(?:\.\d{1,7})?$/)
      .optional(),
    firstDueDate: z.string().date().optional(),
  })
  .strict();
export const incomeSchema = z
  .object({ ...common, categoryId: z.string().uuid().optional() })
  .strict();
export const expenseSchema = z
  .object({ ...common, cardPurchase: cardPurchaseDetails.optional() })
  .strict();
export const transferSchema = z
  .object({ ...common, destinationAccountId: z.string().uuid() })
  .strict()
  .refine(
    (value) => value.accountId !== value.destinationAccountId,
    "Las cuentas deben ser distintas",
  );
export const adjustmentSchema = z
  .object({
    accountId: z.string().uuid(),
    actualBalance: z.string().regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/),
    occurredAt: z.iso.datetime({ offset: true }),
    description: text(250),
  })
  .strict();
export const updateTransactionSchema = z
  .object({
    version: z.number().int().positive(),
    accountId: z.string().uuid().optional(),
    destinationAccountId: z.union([z.string().uuid(), z.null()]).optional(),
    categoryId: z.string().uuid().optional(),
    amount: transactionMoneySchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    description: text(250),
    notes: text(5_000),
    merchantName: text(150),
    cardPurchase: z.union([cardPurchaseDetails, z.null()]).optional(),
  })
  .strict();
export const cancelTransactionSchema = z.object({ version: z.number().int().positive() }).strict();
export const transactionIdSchema = z.string().uuid();
export const listTransactionsSchema = z
  .object({
    type: z.nativeEnum(transaction_type).optional(),
    status: z.nativeEnum(transaction_status).optional(),
    accountId: z.string().uuid().optional(),
    destinationAccountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    dateFrom: z.iso.datetime({ offset: true }).optional(),
    dateTo: z.iso.datetime({ offset: true }).optional(),
    minAmount: transactionMoneySchema.optional(),
    maxAmount: transactionMoneySchema.optional(),
    search: z.string().trim().min(1).max(150).optional(),
    cursor: z.string().max(500).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, "Rango de fechas inválido")
  .refine(
    (v) => !v.minAmount || !v.maxAmount || cents(v.minAmount) <= cents(v.maxAmount),
    "Rango de montos inválido",
  );
export type MovementInput = z.infer<typeof expenseSchema> | z.infer<typeof incomeSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsInput = z.infer<typeof listTransactionsSchema>;
