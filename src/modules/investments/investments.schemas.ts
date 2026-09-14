import { z } from "zod";

export const investmentPlanIdSchema = z.string().uuid();

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha válida (AAAA-MM-DD)");

const moneyString = (label: string, allowZero = false) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim().replace(",", "."))
    .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(value), `${label} inválido`)
    .refine(
      (value) => (allowZero ? Number(value) >= 0 : Number(value) > 0),
      allowZero ? `${label} no puede ser negativo` : `${label} debe ser mayor que cero`,
    );

const rateString = (label: string, min: number, max: number, inclusiveMin = true) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim().replace(",", "."))
    .refine((value) => /^-?\d+(?:\.\d{1,8})?$/.test(value), `${label} inválido`)
    .refine(
      (value) => {
        const number = Number(value);
        return (inclusiveMin ? number >= min : number > min) && number <= max;
      },
      `${label} fuera de rango`,
    );

export const investmentPlanFrequencySchema = z.enum([
  "NONE",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
]);

const investmentPlanCoreSchema = z.object({
  name: z.string().trim().min(2).max(140),
  description: z.string().trim().max(1000).nullish(),
  currency,
  plannedInitialAmount: moneyString("Monto inicial"),
  recurringContribution: moneyString("Aporte periódico", true).default("0"),
  contributionFrequency: investmentPlanFrequencySchema.default("MONTHLY"),
  horizonYears: z.coerce.number().int().min(1).max(50),
  annualReturn: rateString("Rentabilidad anual", -1, 3, false),
  annualFee: rateString("Comisión anual", 0, 0.99999999).default("0"),
  inflationRate: rateString("Inflación", 0, 1).default("0"),
  includeInNetWorth: z.boolean().default(true),
  notes: z.string().trim().max(2000).nullish(),
});

const validateFrequencyContribution = (
  value: {
    contributionFrequency?: z.infer<typeof investmentPlanFrequencySchema>;
    recurringContribution?: string;
  },
  context: z.RefinementCtx,
) => {
  if (
    value.contributionFrequency === "NONE" &&
    value.recurringContribution !== undefined &&
    Number(value.recurringContribution) !== 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["recurringContribution"],
      message: "Usa un aporte de 0 cuando el plan no tiene aportes periódicos",
    });
  }
};

export const createInvestmentPlanSchema = investmentPlanCoreSchema.superRefine(
  validateFrequencyContribution,
);

export const updateInvestmentPlanSchema = investmentPlanCoreSchema
  .partial()
  .superRefine(validateFrequencyContribution)
  .refine((value) => Object.keys(value).length > 0, "No hay cambios para guardar");

export const startInvestmentPlanSchema = z
  .object({
    startDate: dateOnly.optional(),
  })
  .strict();

export const investmentContributionSchema = z
  .object({
    sourceAccountId: z.string().uuid(),
    amount: moneyString("Aporte"),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();

export const investmentWithdrawalSchema = z
  .object({
    destinationAccountId: z.string().uuid(),
    amount: moneyString("Retiro"),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();

export const investmentValuationSchema = z
  .object({
    value: moneyString("Valor actual", true),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();

export const investmentPlanListSchema = z
  .object({
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED", "ALL"]).optional(),
  })
  .strict();

export type CreateInvestmentPlanInput = z.infer<typeof createInvestmentPlanSchema>;
export type UpdateInvestmentPlanInput = z.infer<typeof updateInvestmentPlanSchema>;
export type StartInvestmentPlanInput = z.infer<typeof startInvestmentPlanSchema>;
export type InvestmentContributionInput = z.infer<typeof investmentContributionSchema>;
export type InvestmentWithdrawalInput = z.infer<typeof investmentWithdrawalSchema>;
export type InvestmentValuationInput = z.infer<typeof investmentValuationSchema>;
export type InvestmentPlanListInput = z.infer<typeof investmentPlanListSchema>;
