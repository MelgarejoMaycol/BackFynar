import { Prisma } from "@prisma/client";
export const budgetSelect = Prisma.validator<Prisma.BudgetSelect>()({
  id: true,
  name: true,
  period: true,
  startsOn: true,
  endsOn: true,
  amount: true,
  currency: true,
  alertThreshold: true,
  rolloverEnabled: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  budgetCategories: {
    select: {
      categoryId: true,
      categories: {
        select: {
          id: true,
          name: true,
          type: true,
          icon: true,
          color: true,
          isSystem: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
    orderBy: { categoryId: "asc" },
  },
  budgetAccounts: {
    select: {
      accountId: true,
      financialAccounts: {
        select: {
          id: true,
          name: true,
          type: true,
          nature: true,
          currency: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
    orderBy: { accountId: "asc" },
  },
});
export type BudgetRecord = Prisma.BudgetGetPayload<{ select: typeof budgetSelect }>;
