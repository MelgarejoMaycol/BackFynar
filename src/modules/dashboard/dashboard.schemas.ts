import { z } from "zod";

export const dashboardPeriodSchema = z.enum([
  "CURRENT_MONTH",
  "MY_CYCLE",
  "PREVIOUS_MONTH",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "CUSTOM",
]);

export const dashboardQuerySchema = z
  .object({
    period: dashboardPeriodSchema.default("CURRENT_MONTH"),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    recentLimit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict()
  .superRefine((value, context) => {
    const hasDates = value.dateFrom !== undefined || value.dateTo !== undefined;
    if (value.period === "CUSTOM") {
      if (!value.dateFrom)
        context.addIssue({
          code: "custom",
          path: ["dateFrom"],
          message: "dateFrom es obligatorio",
        });
      if (!value.dateTo)
        context.addIssue({ code: "custom", path: ["dateTo"], message: "dateTo es obligatorio" });
      if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)
        context.addIssue({ code: "custom", path: ["dateTo"], message: "Rango de fechas inválido" });
    } else if (hasDates) {
      context.addIssue({
        code: "custom",
        path: [value.dateFrom ? "dateFrom" : "dateTo"],
        message: "dateFrom y dateTo solo se permiten con period=CUSTOM",
      });
    }
  });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardPeriodType = z.infer<typeof dashboardPeriodSchema>;
