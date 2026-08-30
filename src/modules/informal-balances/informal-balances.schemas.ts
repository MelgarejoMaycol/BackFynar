import { z } from "zod";

export const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Monto inválido").refine((v) => Number(v) > 0, "El monto debe ser mayor que cero");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export const createInformalBalanceSchema = z.object({
  direction: z.enum(["PAYABLE", "RECEIVABLE"]),
  counterpartyName: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(220),
  amount: money,
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).default("COP"),
  occurredOn: date,
  dueOn: date.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updateInformalBalanceSchema = z.object({
  counterpartyName: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().min(1).max(220).optional(),
  dueOn: date.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, "No hay cambios para guardar");

export const listInformalBalancesSchema = z.object({
  direction: z.enum(["PAYABLE", "RECEIVABLE"]).optional(),
  status: z.enum(["OPEN", "PARTIAL", "SETTLED", "CANCELLED"]).optional(),
  search: z.string().trim().max(120).optional(),
});

export const informalPaymentSchema = z.object({
  amount: money,
  paidAt: z.string().datetime({ offset: true }),
  accountId: uuid.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

export type CreateInformalBalanceInput = z.infer<typeof createInformalBalanceSchema>;
export type UpdateInformalBalanceInput = z.infer<typeof updateInformalBalanceSchema>;
export type ListInformalBalancesInput = z.infer<typeof listInformalBalancesSchema>;
export type InformalPaymentInput = z.infer<typeof informalPaymentSchema>;
