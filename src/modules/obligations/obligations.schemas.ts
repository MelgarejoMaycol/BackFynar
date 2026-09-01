import { obligation_amount_type, obligation_status, recurrence_frequency } from "@prisma/client";
import { z } from "zod";
const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
export const uuid = z.string().uuid();
export const createObligationSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    description: z.string().max(5000).nullable().optional(),
    expectedAmount: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountType: z.nativeEnum(obligation_amount_type).default("FIXED"),
    paymentAccountId: uuid.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    remindersEnabled: z.boolean().default(true),
    frequency: z.nativeEnum(recurrence_frequency),
    intervalValue: z.number().int().min(1).max(365).default(1),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startsOn: z.string().date(),
    endsOn: z.string().date().nullable().optional(),
  })
  .strict();
export const updateObligationSchema = createObligationSchema
  .partial()
  .extend({ status: z.nativeEnum(obligation_status).optional() })
  .refine((x) => Object.keys(x).length > 0);
export const occurrenceSchema = z
  .object({ dueDate: z.string().date(), amount: money.optional() })
  .strict();
export const occurrencePaymentSchema = z
  .object({
    accountId: uuid,
    amount: money,
    occurredAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().min(8).max(100),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export const updateOccurrencePaymentSchema = z
  .object({
    accountId: uuid.optional(),
    amount: money.optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(({ version: _version, ...changes }) => Object.keys(changes).length > 0, {
    message: "Debes enviar al menos un cambio",
  });
export const reverseOccurrencePaymentSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    version: z.number().int().positive(),
  })
  .strict();
export type CreateObligationInput = z.infer<typeof createObligationSchema>;
export type UpdateObligationInput = z.infer<typeof updateObligationSchema>;
export type UpdateOccurrencePaymentInput = z.infer<typeof updateOccurrencePaymentSchema>;
