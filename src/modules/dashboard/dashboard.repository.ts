import type { PrismaClient, transaction_type } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
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
    const [accounts, currentTotals, previousTotals, recentTransactions, expenses] =
      await Promise.all([
        this.database.financialAccount.findMany({
          where: { workspaceId, isActive: true, deletedAt: null },
          select: dashboardAccountSelect,
          orderBy: [{ isFavorite: "desc" }, { name: "asc" }, { id: "asc" }],
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
      ]);
    const categoryIds = expenses.flatMap((row) => (row.categoryId ? [row.categoryId] : []));
    const categories = await this.database.category.findMany({
      where: { id: { in: categoryIds }, OR: [{ workspaceId }, { workspaceId: null }] },
      select: { id: true, name: true, icon: true, color: true },
    });
    return { accounts, currentTotals, previousTotals, recentTransactions, expenses, categories };
  }
}

export const dashboardRepository = new DashboardRepository();
export type DashboardReadData = Awaited<ReturnType<DashboardRepository["read"]>>;
