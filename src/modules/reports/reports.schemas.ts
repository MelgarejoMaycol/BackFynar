import { account_nature, account_type } from "@prisma/client";
import { z } from "zod";
export const reportPeriodSchema = z.enum([
  "CURRENT_MONTH",
  "PREVIOUS_MONTH",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "CURRENT_YEAR",
  "PREVIOUS_YEAR",
  "CUSTOM",
]);
export const reportGroupSchema = z.enum(["DAY", "WEEK", "MONTH"]);
export const reportCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const base = {
  period: reportPeriodSchema.default("CURRENT_MONTH"),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  currency: reportCurrencySchema.optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
};
const rangeDays = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  ) + 1;
const validateRange = (
  v: {
    period: z.infer<typeof reportPeriodSchema>;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.period === "CUSTOM") {
    if (!v.dateFrom)
      ctx.addIssue({ code: "custom", path: ["dateFrom"], message: "dateFrom es obligatorio" });
    if (!v.dateTo)
      ctx.addIssue({ code: "custom", path: ["dateTo"], message: "dateTo es obligatorio" });
    if (v.dateFrom && v.dateTo && (v.dateFrom > v.dateTo || rangeDays(v.dateFrom, v.dateTo) > 366))
      ctx.addIssue({
        code: "custom",
        path: ["dateTo"],
        message: "Rango inválido o mayor a 366 días",
      });
  } else if (v.dateFrom || v.dateTo)
    ctx.addIssue({
      code: "custom",
      path: [v.dateFrom ? "dateFrom" : "dateTo"],
      message: "Las fechas solo se permiten con CUSTOM",
    });
};
export const commonReportSchema = z.object(base).strict().superRefine(validateRange);
export const categoryReportSchema = z
  .object({ ...base, limit: z.coerce.number().int().min(1).max(100).default(20) })
  .strict()
  .superRefine(validateRange);
export const cashFlowReportSchema = z
  .object({ ...base, groupBy: reportGroupSchema.optional() })
  .strict()
  .superRefine((v, ctx) => {
    validateRange(v, ctx);
    const days =
      v.period === "CUSTOM" && v.dateFrom && v.dateTo ? rangeDays(v.dateFrom, v.dateTo) : null;
    const group = v.groupBy;
    if (
      (v.period === "LAST_7_DAYS" && group && group !== "DAY") ||
      (["LAST_30_DAYS", "CURRENT_MONTH", "PREVIOUS_MONTH"].includes(v.period) &&
        group === "MONTH") ||
      (["CURRENT_YEAR", "PREVIOUS_YEAR"].includes(v.period) && group && group !== "MONTH") ||
      (v.period === "CUSTOM" &&
        group &&
        ((group === "DAY" && days! > 31) || (group === "WEEK" && days! > 120)))
    )
      ctx.addIssue({
        code: "custom",
        path: ["groupBy"],
        message: "groupBy incompatible con el periodo",
      });
  });
export const accountBalancesReportSchema = z
  .object({
    currency: reportCurrencySchema.optional(),
    nature: z.nativeEnum(account_nature).optional(),
    type: z.nativeEnum(account_type).optional(),
    includeArchived: z.enum(["true", "false"]).default("false"),
    search: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CommonReportQuery = z.infer<typeof commonReportSchema>;
export type CategoryReportQuery = z.infer<typeof categoryReportSchema>;
export type CashFlowReportQuery = z.infer<typeof cashFlowReportSchema>;
export type AccountBalancesReportQuery = z.infer<typeof accountBalancesReportSchema>;
export type ReportPeriodType = z.infer<typeof reportPeriodSchema>;
export type ReportGroup = z.infer<typeof reportGroupSchema>;
