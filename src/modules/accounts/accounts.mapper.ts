import type { Prisma } from "@prisma/client";

export const accountSelect = {
  id: true,
  name: true,
  type: true,
  nature: true,
  institutionName: true,
  currency: true,
  openingBalance: true,
  currentBalance: true,
  creditLimit: true,
  billingDay: true,
  paymentDueDay: true,
  color: true,
  icon: true,
  isFavorite: true,
  isActive: true,
  includeInNetWorth: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FinancialAccountSelect;

export type AccountRecord = Prisma.FinancialAccountGetPayload<{ select: typeof accountSelect }>;
export const toPublicAccount = (account: AccountRecord) => ({
  ...account,
  openingBalance: account.openingBalance.toFixed(2),
  currentBalance: account.currentBalance.toFixed(2),
  creditLimit: account.creditLimit?.toFixed(2) ?? null,
});
