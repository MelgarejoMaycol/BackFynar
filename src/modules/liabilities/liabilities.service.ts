import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
const money = (x: Prisma.Decimal | null) => x?.toFixed(2) ?? "0.00";
export class LiabilitiesService {
  constructor(private db: PrismaClient = prisma) {}
  async upcoming(workspaceId: string, reference = new Date()) {
    const referenceDay = Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
    );
    const [installments, occurrences, statements] = await Promise.all([
      this.db.debtInstallment.findMany({
        where: { workspaceId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        include: { debts: { select: { name: true, currency: true } } },
        orderBy: { dueDate: "asc" },
        take: 100,
      }),
      this.db.obligationOccurrence.findMany({
        where: { workspaceId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        include: { obligation: { select: { name: true, currency: true } } },
        orderBy: { dueDate: "asc" },
        take: 100,
      }),
      this.db.cardStatement.findMany({
        where: { workspaceId, status: { in: ["OPEN", "PARTIAL"] } },
        include: { cardAccount: { select: { name: true, currency: true } } },
        orderBy: { dueDate: "asc" },
        take: 100,
      }),
    ]);
    const item = (
      type: string,
      id: string,
      resourceId: string,
      name: string,
      d: Date,
      amount: Prisma.Decimal,
      currency: string,
      status: string,
    ) => ({
      type,
      resourceId,
      id,
      name,
      date: d.toISOString().slice(0, 10),
      amount: amount.toFixed(2),
      currency,
      status: d.getTime() < referenceDay && status !== "PAID" ? "OVERDUE" : status,
      daysRemaining: Math.round((d.getTime() - referenceDay) / 86400000),
    });
    return [
      ...installments.map((x) =>
        item(
          "DEBT_INSTALLMENT",
          x.id,
          x.debtId,
          x.debts.name,
          x.dueDate,
          x.totalAmount.minus(x.paidAmount),
          x.debts.currency,
          x.status,
        ),
      ),
      ...occurrences.map((x) =>
        item(
          "OBLIGATION",
          x.id,
          x.obligationId,
          x.obligation.name,
          x.dueDate,
          x.amount.minus(x.paidAmount),
          x.obligation.currency,
          x.status,
        ),
      ),
      ...statements.map((x) =>
        item(
          "CARD_STATEMENT",
          x.id,
          x.cardAccountId,
          x.cardAccount.name,
          x.dueDate,
          (x.reportedBalance ?? x.calculatedBalance).minus(x.paidAmount),
          x.cardAccount.currency,
          x.status,
        ),
      ),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 100);
  }
  async summary(w: string) {
    const now = new Date(),
      monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [debts, obligations, cards, paid, upcoming, debtsByCurrency] = await Promise.all([
      this.db.debt.aggregate({
        _sum: { currentBalance: true },
        _count: true,
        where: { workspaceId: w, status: "ACTIVE", deletedAt: null },
      }),
      this.db.recurringObligation.count({
        where: { workspaceId: w, status: "ACTIVE", deletedAt: null },
      }),
      this.db.financialAccount.findMany({
        where: { workspaceId: w, type: "CREDIT_CARD", nature: "LIABILITY", deletedAt: null },
      }),
      this.db.debtPayment.aggregate({
        _sum: { principalAmount: true, interestAmount: true },
        where: { workspaceId: w, reversedAt: null },
      }),
      this.upcoming(w, now),
      this.db.debt.groupBy({
        by: ["currency"],
        _sum: { currentBalance: true },
        where: { workspaceId: w, status: "ACTIVE", deletedAt: null },
      }),
    ]);
    const month = upcoming.filter((x) => new Date(x.date) < monthEnd),
      overdue = upcoming.filter((x) => x.status === "OVERDUE");
    const sum = (a: { amount: string }[]) =>
        a.reduce((v, x) => v.plus(x.amount), new Prisma.Decimal(0)).toFixed(2),
      limit = cards.reduce((v, x) => v.plus(x.creditLimit ?? 0), new Prisma.Decimal(0)),
      used = cards.reduce(
        (v, x) => v.plus(Prisma.Decimal.max(0, x.currentBalance)),
        new Prisma.Decimal(0),
      );
    const currencies = new Set([
      ...debtsByCurrency.map((item) => item.currency),
      ...upcoming.map((item) => item.currency),
      ...cards.map((item) => item.currency),
    ]);
    const summariesByCurrency = [...currencies].sort().map((currency) => ({
      currency,
      totalDebt:
        debtsByCurrency
          .find((item) => item.currency === currency)
          ?._sum.currentBalance?.toFixed(2) ?? "0.00",
      monthlyCommitments: sum(month.filter((item) => item.currency === currency)),
      overdueAmount: sum(overdue.filter((item) => item.currency === currency)),
    }));
    return {
      totalDebt: money(debts._sum.currentBalance),
      monthlyCommitments: sum(month),
      nextPayment: upcoming[0] ?? null,
      overdueAmount: sum(overdue),
      principalPaid: money(paid._sum.principalAmount),
      interestPaid: money(paid._sum.interestAmount),
      activeDebts: debts._count,
      activeObligations: obligations,
      cards: {
        creditLimit: limit.toFixed(2),
        used: used.toFixed(2),
        available: Prisma.Decimal.max(0, limit.minus(used)).toFixed(2),
        utilization: limit.gt(0) ? used.div(limit).mul(100).toDecimalPlaces(2).toString() : "0",
      },
      summariesByCurrency,
      upcoming: upcoming.slice(0, 10),
    };
  }
}
export const liabilitiesService = new LiabilitiesService();
