import { z } from "zod";

export const financialHealthHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(2).max(24).default(12),
  })
  .strict();

export type FinancialHealthHistoryQuery = z.infer<typeof financialHealthHistoryQuerySchema>;
