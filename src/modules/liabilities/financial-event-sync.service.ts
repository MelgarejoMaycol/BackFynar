import { Prisma } from "@prisma/client";

type EventClient = Pick<Prisma.TransactionClient, "financialEvent">;

export const syncFinancialEvent = (
  db: EventClient,
  where: Prisma.FinancialEventWhereInput,
  state: { isCompleted: boolean; remainingAmount?: Prisma.Decimal },
) =>
  db.financialEvent.updateMany({
    where,
    data: {
      isCompleted: state.isCompleted,
      ...(state.remainingAmount !== undefined ? { amount: state.remainingAmount } : {}),
      updatedAt: new Date(),
    },
  });

export const debtInstallmentEventWhere = (workspaceId: string, installmentId: string) => ({
  workspaceId,
  type: "DEBT_INSTALLMENT_DUE" as const,
  relatedDebtInstallmentId: installmentId,
});

export const obligationEventWhere = (workspaceId: string, occurrenceId: string) => ({
  workspaceId,
  relatedObligationOccurrenceId: occurrenceId,
});

export const cardStatementEventWhere = (workspaceId: string, statementId: string) => ({
  workspaceId,
  relatedCardStatementId: statementId,
});
