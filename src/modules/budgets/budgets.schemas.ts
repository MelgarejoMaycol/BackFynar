import { budget_period } from "@prisma/client";
import { z } from "zod";

export const budgetMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  .refine((v) => !/^0(?:\.0{1,2})?$/.test(v), "Debe ser mayor que cero");
export const budgetThresholdSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/)
  .refine((v) => Number(v) > 0, "Debe ser mayor que cero");
export const budgetCurrencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());
const uniqueUuids = z
  .array(z.string().uuid())
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Los IDs no pueden repetirse");

const validatePeriod = (
  value: { period: budget_period; startsOn: string; endsOn: string },
  context: z.RefinementCtx,
) => {
  if (value.startsOn > value.endsOn) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "Rango inválido" });
    return;
  }
  const start = new Date(`${value.startsOn}T00:00:00Z`);
  const end = new Date(`${value.endsOn}T00:00:00Z`);
  const inclusiveDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (value.period === "WEEKLY" && inclusiveDays !== 7)
    context.addIssue({
      code: "custom",
      path: ["endsOn"],
      message: "WEEKLY debe contener exactamente 7 días",
    });
  if (
    value.period === "MONTHLY" &&
    (start.getUTCDate() !== 1 ||
      end.getUTCFullYear() !== start.getUTCFullYear() ||
      end.getUTCMonth() !== start.getUTCMonth() ||
      end.getUTCDate() !==
        new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate())
  )
    context.addIssue({
      code: "custom",
      path: ["endsOn"],
      message: "MONTHLY debe cubrir un mes calendario completo",
    });
  if (
    value.period === "YEARLY" &&
    (value.startsOn !== `${start.getUTCFullYear()}-01-01` ||
      value.endsOn !== `${start.getUTCFullYear()}-12-31`)
  )
    context.addIssue({
      code: "custom",
      path: ["endsOn"],
      message: "YEARLY debe cubrir un año calendario completo",
    });
};

const definition = {
  name: z.string().trim().min(1).max(120),
  period: z.nativeEnum(budget_period),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  amount: budgetMoneySchema,
  currency: budgetCurrencySchema,
  alertThreshold: budgetThresholdSchema.default("80.00"),
  rolloverEnabled: z.boolean().default(false),
  categoryIds: uniqueUuids.default([]),
  accountIds: uniqueUuids.default([]),
};
export const createBudgetSchema = z.object(definition).strict().superRefine(validatePeriod);
export const updateBudgetSchema = z
  .object({
    name: definition.name.optional(),
    period: definition.period.optional(),
    startsOn: definition.startsOn.optional(),
    endsOn: definition.endsOn.optional(),
    amount: definition.amount.optional(),
    currency: definition.currency.optional(),
    alertThreshold: budgetThresholdSchema.optional(),
    rolloverEnabled: z.boolean().optional(),
    categoryIds: uniqueUuids.optional(),
    accountIds: uniqueUuids.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Debe enviar al menos un campo");
export const budgetIdSchema = z.string().uuid();
export const listBudgetsSchema = z
  .object({
    includeArchived: z.enum(["true", "false"]).default("false"),
    status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional(),
    period: z.nativeEnum(budget_period).optional(),
    currency: budgetCurrencySchema.optional(),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    categoryId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, "Rango inválido");

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type ListBudgetsInput = z.infer<typeof listBudgetsSchema>;
export { validatePeriod };
