import { z } from "zod";

export const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Monto inválido");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export const createPersonalBalanceSchema = z.object({
  personId: uuid,
  direction: z.enum(["PAYABLE", "RECEIVABLE"]),
  amount: money,
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("COP"),
  description: z.string().trim().max(250).optional().nullable(),
  occurredOn: dateOnly.optional(),
  dueOn: dateOnly.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updatePersonalBalanceSchema = z.object({
  personId: uuid.optional(),
  originalAmount: money.optional(),
  description: z.string().trim().max(250).optional().nullable(),
  dueOn: dateOnly.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar");

export const personalBalanceEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("PAYMENT"),
    amount: money,
    accountId: uuid,
    notes: z.string().trim().max(2000).optional().nullable(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({
    type: z.literal("INCREASE"),
    amount: money,
    notes: z.string().trim().max(2000).optional().nullable(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  }),
]);

export const createPersonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export const updatePersonSchema = createPersonSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "No hay cambios para guardar",
);

export type CreatePersonalBalanceInput = z.infer<typeof createPersonalBalanceSchema>;
export type UpdatePersonalBalanceInput = z.infer<typeof updatePersonalBalanceSchema>;
export type PersonalBalanceEntryInput = z.infer<typeof personalBalanceEntrySchema>;
export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
