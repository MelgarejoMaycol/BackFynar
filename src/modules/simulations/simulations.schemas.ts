import { z } from "zod";

export const purchaseSimulationSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    amount: z.coerce.number().positive().finite(),
    paymentMethod: z.enum(["CASH", "CREDIT_CARD", "FINANCING"]),
    accountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    installments: z.coerce.number().int().min(1).max(120).default(1),
    monthlyRate: z.coerce.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === "CASH" && !value.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Selecciona la cuenta desde la que pagarías." });
    }
    if (value.paymentMethod === "CREDIT_CARD" && !value.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Selecciona la tarjeta que usarías." });
    }
    if (value.paymentMethod !== "CASH" && value.installments > 1 && value.monthlyRate === undefined) {
      ctx.addIssue({ code: "custom", path: ["monthlyRate"], message: "Indica la tasa mensual para calcular una financiación a más de una cuota." });
    }
  });

export type PurchaseSimulationInput = z.infer<typeof purchaseSimulationSchema>;


export const investmentContributionFrequencySchema = z.enum([
  "NONE",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
]);

const decimalString = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim().replace(",", "."))
    .refine((value) => /^-?\d+(?:\.\d{1,8})?$/.test(value), `${label} inválido`);

const positiveMoneyString = (label: string) =>
  decimalString(label).refine((value) => Number(value) > 0, `${label} debe ser mayor que cero`);

const nonNegativeMoneyString = (label: string) =>
  decimalString(label).refine((value) => Number(value) >= 0, `${label} no puede ser negativo`);

const annualReturnString = decimalString("Rentabilidad anual").refine(
  (value) => Number(value) > -1 && Number(value) <= 3,
  "La rentabilidad anual debe estar entre -99% y 300%",
);

const annualFeeString = decimalString("Comisión anual").refine(
  (value) => Number(value) >= 0 && Number(value) < 1,
  "La comisión anual debe estar entre 0% y menos de 100%",
);

const inflationRateString = decimalString("Inflación").refine(
  (value) => Number(value) >= 0 && Number(value) <= 1,
  "La inflación debe estar entre 0% y 100%",
);

export const investmentSimulationSchema = z
  .object({
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
    initialAmount: positiveMoneyString("Monto inicial"),
    recurringContribution: nonNegativeMoneyString("Aporte periódico").default("0"),
    contributionFrequency: investmentContributionFrequencySchema.default("MONTHLY"),
    years: z.coerce.number().int().min(1).max(50),
    annualReturn: annualReturnString,
    annualFee: annualFeeString.default("0"),
    inflationRate: inflationRateString.default("0"),
  })
  .superRefine((value, context) => {
    if (value.contributionFrequency === "NONE" && Number(value.recurringContribution) !== 0) {
      context.addIssue({
        code: "custom",
        path: ["recurringContribution"],
        message: "Usa un aporte de 0 cuando no hay aportes periódicos",
      });
    }
  });

export const investmentScenarioSchema = investmentSimulationSchema
  .omit({ annualReturn: true })
  .extend({
    baseAnnualReturn: annualReturnString,
    spread: z
      .union([z.string(), z.number()])
      .transform((value) => String(value).trim().replace(",", "."))
      .refine(
        (value) => Number(value) >= 0 && Number(value) <= 0.5,
        "La amplitud de escenarios debe estar entre 0% y 50%",
      )
      .default("0.04"),
  });

export const investmentFinancialImpactSchema = z.object({
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  initialAmount: positiveMoneyString("Monto inicial"),
  recurringContribution: nonNegativeMoneyString("Aporte periódico").default("0"),
});

export type InvestmentSimulationBody = z.infer<typeof investmentSimulationSchema>;
export type InvestmentScenarioBody = z.infer<typeof investmentScenarioSchema>;
export type InvestmentFinancialImpactBody = z.infer<typeof investmentFinancialImpactSchema>;
