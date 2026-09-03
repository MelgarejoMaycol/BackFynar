import { z } from "zod";

export const purchaseSimulationSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    amount: z.coerce.number().positive().finite(),
    paymentMethod: z.enum(["CASH", "CREDIT_CARD", "FINANCING"]),
    accountId: z.string().uuid().optional(),
    installments: z.coerce.number().int().min(1).max(120).default(1),
    monthlyRate: z.coerce.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === "CASH" && !value.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Selecciona la cuenta desde la que pagarías." });
    }
    if (value.paymentMethod !== "CASH" && value.installments > 1 && value.monthlyRate === undefined) {
      ctx.addIssue({ code: "custom", path: ["monthlyRate"], message: "Indica la tasa mensual para calcular una financiación a más de una cuota." });
    }
  });

export type PurchaseSimulationInput = z.infer<typeof purchaseSimulationSchema>;
