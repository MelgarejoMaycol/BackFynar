import { obligation_amount_type } from "@prisma/client";
import { z } from "zod";

const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
export const recurringSuggestionIdSchema = z.string().uuid();
export const detectorFrequencySchema = z.enum([
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "YEARLY",
]);

export const recurringRunSchema = z
  .object({ months: z.number().int().min(3).max(24).default(12) })
  .strict();

export const confirmRecurringSuggestionSchema = z
  .object({
    months: z.number().int().min(3).max(24).optional(),
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    expectedAmount: money.optional(),
    amountType: z.nativeEnum(obligation_amount_type).optional(),
    paymentAccountId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    remindersEnabled: z.boolean().optional(),
    frequency: detectorFrequencySchema.optional(),
    startsOn: z.string().date().optional(),
  })
  .strict();

export type ConfirmRecurringSuggestionInput = z.infer<typeof confirmRecurringSuggestionSchema>;
