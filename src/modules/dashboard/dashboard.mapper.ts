import type { Prisma } from "@prisma/client";

export const dashboardAccountSelect = {
  id: true,
  name: true,
  type: true,
  nature: true,
  currency: true,
  currentBalance: true,
  isFavorite: true,
  includeInNetWorth: true,
} satisfies Prisma.FinancialAccountSelect;

export type DashboardAccount = Prisma.FinancialAccountGetPayload<{
  select: typeof dashboardAccountSelect;
}>;

export const toDashboardAccount = (account: DashboardAccount) => ({
  ...account,
  currentBalance: account.currentBalance.toFixed(2),
});
