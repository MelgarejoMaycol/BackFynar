import { goal_status } from "@prisma/client";
import { z } from "zod";

const money = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  .refine((value) => !/^0(?:\.0{1,2})?$/.test(value), "Debe ser mayor que cero");

export const goalAmountSchema = money;
export const contributionAmountSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  .refine((value) => !/^-?0(?:\.0{1,2})?$/.test(value), "El aporte no puede ser cero");

const nullableUuid = z.union([z.string().uuid(), z.null()]);
const nullableDate = z.union([z.iso.date(), z.null()]);
const nullableText = (max: number) => z.union([z.string().trim().min(1).max(max), z.null()]);

export const createGoalSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    targetAmount: money,
    targetDate: nullableDate.optional(),
    accountId: nullableUuid.optional(),
    icon: nullableText(80).optional(),
    color: z
      .union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.null()])
      .optional(),
  })
  .strict();

export const updateGoalSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    targetAmount: money.optional(),
    targetDate: nullableDate.optional(),
    accountId: nullableUuid.optional(),
    icon: nullableText(80).optional(),
    color: z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Debe enviar al menos un campo");

export const listGoalsSchema = z
  .object({
    status: z.nativeEnum(goal_status).optional(),
    includeArchived: z.enum(["true", "false"]).default("false"),
    search: z.string().trim().min(1).max(150).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const createContributionSchema = z
  .object({
    amount: contributionAmountSchema,
    contributedAt: z.iso.datetime({ offset: true }).optional(),
    transactionId: nullableUuid.optional(),
  })
  .strict();

export const goalIdSchema = z.string().uuid();
export const contributionIdSchema = z.string().uuid();

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type ListGoalsInput = z.infer<typeof listGoalsSchema>;
export type CreateContributionInput = z.infer<typeof createContributionSchema>;
