import { Prisma, type PrismaClient, type transaction_type } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { reservationsByAccount } from "../goals/goals.reservations.js";
import { transactionSelect } from "../transactions/transactions.mapper.js";
import { dashboardAccountSelect } from "./dashboard.mapper.js";
import type { DashboardPeriod } from "./dashboard.period.js";

const financialTypes: transaction_type[] = ["INCOME", "EXPENSE"];
const visibleTypes: transaction_type[] = ["INCOME", "EXPENSE", "TRANSFER", "ADJUSTMENT"];
const transactionWhere = (workspaceId: string, start: Date, end: Date) => ({
  workspaceId,
  status: "CONFIRMED" as const,
  deletedAt: null,
  type: { in: financialTypes },
  occurredAt: { gte: start, lt: end },
});

export class DashboardRepository {
  constructor(private readonly database: PrismaClient = prisma) {}
  async financialCycleStartDay(userId: string) {
    return (
      await this.database.userPreference.findUnique({
        where: { userId },
        select: { financialCycleStartDay: true },
      })
    )?.financialCycleStartDay;
  }
  async read(workspaceId: string, period: DashboardPeriod, recentLimit: number) {
    const [
      accounts,
      receivables,
      currentTotals,
      previousTotals,
      recentTransactions,
      expenses,
      goalReservations,
    ] = await Promise.all([
      this.database.financialAccount.findMany({
        where: {
          workspaceId,
          isActive: true,
          deletedAt: null,
          issuedLoansReceivable: { none: {} },
        },
        select: dashboardAccountSelect,
        orderBy: [{ isFavorite: "desc" }, { name: "asc" }, { id: "asc" }],
      }),
      this.database.financialAccount.groupBy({
        by: ["currency"],
        where: {
          workspaceId,
          isActive: true,
          deletedAt: null,
          includeInNetWorth: true,
          issuedLoansReceivable: { some: { archivedAt: null } },
        },
        _sum: { currentBalance: true },
      }),
      this.database.transaction.groupBy({
        by: ["currency", "type"],
        where: transactionWhere(workspaceId, period.start, period.endExclusive),
        _sum: { amount: true },
      }),
      this.database.transaction.groupBy({
        by: ["currency", "type"],
        where: transactionWhere(workspaceId, period.previousStart, period.previousEndExclusive),
        _sum: { amount: true },
      }),
      this.database.transaction.findMany({
        where: {
          workspaceId,
          status: "CONFIRMED",
          deletedAt: null,
          type: { in: visibleTypes },
        },
        select: transactionSelect,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: recentLimit,
      }),
      this.database.transaction.groupBy({
        by: ["categoryId", "currency"],
        where: {
          workspaceId,
          status: "CONFIRMED",
          deletedAt: null,
          type: "EXPENSE",
          occurredAt: { gte: period.start, lt: period.endExclusive },
        },
        _sum: { amount: true },
      }),
      reservationsByAccount(this.database, workspaceId),
    ]);
    const categoryIds = expenses.flatMap((row) => (row.categoryId ? [row.categoryId] : []));
    const categories = await this.database.category.findMany({
      where: { id: { in: categoryIds }, OR: [{ workspaceId }, { workspaceId: null }] },
      select: { id: true, name: true, icon: true, color: true },
    });
    return {
      accounts,
      receivables,
      currentTotals,
      previousTotals,
      recentTransactions,
      expenses,
      categories,
      goalReservations,
    };
  }

  loanCollections(workspaceId: string, startsOn: string, endsOn: string) {
    return this.database.$queryRaw<Array<{ currency: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT l.currency, COALESCE(SUM(i.total_amount-i.total_paid), 0)::numeric AS amount
      FROM issued_loan_installments i
      JOIN issued_loans l ON l.workspace_id=i.workspace_id AND l.id=i.loan_id
      WHERE i.workspace_id=${workspaceId}::uuid
        AND l.archived_at IS NULL
        AND l.status IN ('ACTIVE','OVERDUE')
        AND i.total_paid < i.total_amount
        AND i.due_date >= ${startsOn}::date
        AND i.due_date <= ${endsOn}::date
      GROUP BY l.currency
      ORDER BY l.currency
    `);
  }
}

export const dashboardRepository = new DashboardRepository();
export type DashboardReadData = Awaited<ReturnType<DashboardRepository["read"]>>;
