import { z } from "zod";

export const uuid = z.string().uuid();
const money = z.coerce.number().positive().max(999_999_999_999.99);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha válida (AAAA-MM-DD)");
const method = z.enum(["FIXED_PAYMENT", "FIXED_PRINCIPAL", "INTEREST_ONLY"]);
const frequency = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]);

export const simulationSchema = z.object({
  principal: money,
  ratePercent: z.coerce.number().min(0).max(100),
  termCount: z.coerce.number().int().min(1).max(600),
  method,
  frequency,
  firstPaymentDate: dateOnly.optional(),
}).strict();

export const createLoanSchema = simulationSchema.extend({
  personId: uuid,
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  sourceAccountId: uuid.nullish(),
  disbursementDate: dateOnly,
  firstPaymentDate: dateOnly,
  notes: z.string().trim().max(2000).nullish(),
}).strict().superRefine((value, context) => {
  if (value.firstPaymentDate < value.disbursementDate) {
    context.addIssue({ code: "custom", path: ["firstPaymentDate"], message: "El primer cobro no puede ser anterior al desembolso" });
  }
});

export const updateLoanSchema = z.object({
  personId: uuid.optional(),
  notes: z.string().trim().max(2000).nullish(),
}).strict().refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar");

export const paymentSchema = z.object({
  amount: money,
  receivingAccountId: uuid,
  occurredAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().trim().max(1000).nullish(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
}).strict();

export const listLoansSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "OVERDUE", "PAID", "ARCHIVED", "ALL"]).optional(),
}).strict();

export type SimulationInput = z.infer<typeof simulationSchema>;
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type UpdateLoanInput = z.infer<typeof updateLoanSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ListLoansInput = z.infer<typeof listLoansSchema>;
