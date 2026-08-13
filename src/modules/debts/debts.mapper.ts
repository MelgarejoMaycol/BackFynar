import type { Prisma } from "@prisma/client";
export const debtInclude = {
  debtInstallments: { orderBy: { installmentNumber: "asc" as const } },
} satisfies Prisma.DebtInclude;
type DebtRecord = Prisma.DebtGetPayload<{ include: typeof debtInclude }>;
const decimal = (value: { toFixed(n: number): string } | null) => value?.toFixed(2) ?? null;
export const publicDebt = (debt: DebtRecord | Prisma.DebtGetPayload<object>) => ({
  ...debt,
  originalAmount: decimal(debt.originalAmount),
  currentBalance: decimal(debt.currentBalance),
  interestRate: debt.interestRate?.toString(),
  installmentAmount: decimal(debt.installmentAmount),
  debtInstallments:
    "debtInstallments" in debt
      ? debt.debtInstallments.map((x) => ({
          ...x,
          openingBalance: decimal(x.openingBalance),
          principalAmount: decimal(x.principalAmount),
          interestAmount: decimal(x.interestAmount),
          insuranceAmount: decimal(x.insuranceAmount),
          feeAmount: decimal(x.feeAmount),
          totalAmount: decimal(x.totalAmount),
          paidAmount: decimal(x.paidAmount),
          closingBalance: decimal(x.closingBalance),
        }))
      : undefined,
});
