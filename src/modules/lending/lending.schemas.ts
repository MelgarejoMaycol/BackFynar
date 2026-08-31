import { z } from "zod";

export const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Monto inválido");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export const simulationSchema = z.object({
  principal: money,
  ratePercent: z.coerce.number().min(0).max(1000),
  termCount: z.coerce.number().int().min(1).max(600),
  method: z.enum(["FIXED_PAYMENT", "FIXED_PRINCIPAL", "INTEREST_ONLY"]).default("FIXED_PAYMENT"),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]).default("MONTHLY"),
  firstPaymentDate: dateOnly.optional(),
});

export const createLoanSchema = simulationSchema.extend({
  borrowerName: z.string().trim().min(2).max(150),
  borrowerPhone: z.string().trim().max(40).optional().nullable(),
  borrowerDocument: z.string().trim().max(80).optional().nullable(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  sourceAccountId: uuid.optional().nullable(),
  disbursementDate: dateOnly,
  firstPaymentDate: dateOnly,
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const updateLoanSchema = z.object({
  borrowerName: z.string().trim().min(2).max(150).optional(),
  borrowerPhone: z.string().trim().max(40).optional().nullable(),
  borrowerDocument: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const paymentSchema = z.object({
  receivingAccountId: uuid,
  amount: money,
  occurredAt: z.string().datetime().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

export type SimulationInput = z.infer<typeof simulationSchema>;
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type UpdateLoanInput = z.infer<typeof updateLoanSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
