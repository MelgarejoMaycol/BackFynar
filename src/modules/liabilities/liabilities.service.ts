import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { nextMonthlyDate } from "../cards/domain/card-cycle.js";
export class LiabilitiesService {
  constructor(private db: PrismaClient = prisma) { }

  private dateOnly(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private nextOccurrenceDate(
    current: Date,
    frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
    intervalValue: number,
    dayOfMonth?: number | null,
  ) {
    const next = new Date(current);
    if (frequency === "DAILY") next.setUTCDate(next.getUTCDate() + intervalValue);
    if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7 * intervalValue);
    if (frequency === "YEARLY") next.setUTCFullYear(next.getUTCFullYear() + intervalValue);
    if (frequency === "MONTHLY") {
      const targetMonth = next.getUTCMonth() + intervalValue;
      const targetYear = next.getUTCFullYear() + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      const desiredDay = dayOfMonth ?? next.getUTCDate();
      const monthLength = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
      next.setUTCFullYear(targetYear, normalizedMonth, Math.min(desiredDay, monthLength));
    }
    return next;
  }

  private nextActionableByResource<T extends { resourceId: string; date: string; status: string; source: string; name: string }>(items: T[]) {
    const ranked = new Map<string, T>();
    const statusOrder = { OVERDUE: 0, PARTIAL: 1, PENDING: 2, PAID: 3, CANCELLED: 4 };
    const sourceOrder = { INFORMED: 0, ESTIMATED: 1, SCHEDULED: 2, ACTUAL: 0, PROJECTED: 2 };
    for (const item of items) {
      const current = ranked.get(item.resourceId);
      if (!current) {
        ranked.set(item.resourceId, item);
        continue;
      }
      const itemDate = item.date.localeCompare(current.date);
      const byDate = itemDate < 0 || (itemDate === 0 && statusOrder[item.status as keyof typeof statusOrder] < statusOrder[current.status as keyof typeof statusOrder]);
      const byStatus = itemDate === 0 && statusOrder[item.status as keyof typeof statusOrder] === statusOrder[current.status as keyof typeof statusOrder] && sourceOrder[item.source as keyof typeof sourceOrder] < sourceOrder[current.source as keyof typeof sourceOrder];
      if (byDate || byStatus) ranked.set(item.resourceId, item);
    }
    return [...ranked.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }

  async upcoming(workspaceId: string, reference = new Date()) {
    const referenceDay = Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
    );
    const [installments, occurrences, statements, expectations, cards, workspace] = await Promise.all([
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
      this.db.cardPaymentExpectation.findMany({
        where: {
          workspaceId,
          supersededAt: null,
          status: { not: "CANCELLED" },
        },
        include: { cardAccount: { select: { name: true, currency: true } } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 100,
      }),
      this.db.financialAccount.findMany({
        where: {
          workspaceId,
          type: "CREDIT_CARD",
          nature: "LIABILITY",
          currentBalance: { gt: 0 },
          isActive: true,
          deletedAt: null,
          paymentDueDay: { not: null },
        },
      }),
      this.db.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } }),
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
      source: "INFORMED" | "ESTIMATED" | "SCHEDULED" = "SCHEDULED",
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
      source,
      amountLabel: source === "ESTIMATED" ? "Saldo estimado del periodo" : "Monto pendiente",
    });
    const expectationCardIds = new Set(expectations.map((expectation) => expectation.cardAccountId));
    const statementCardIds = new Set([
      ...statements.map((statement) => statement.cardAccountId),
      ...expectationCardIds,
    ]);
    const all = [
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
          "SCHEDULED",
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
          "SCHEDULED",
        ),
      ),
      ...expectations.filter((x) => x.status !== "PAID").map((x) =>
        item(
          "CARD_STATEMENT",
          x.id,
          x.cardAccountId,
          x.cardAccount.name,
          x.dueDate,
          x.amount.minus(x.paidAmount),
          x.cardAccount.currency,
          x.status,
          "INFORMED",
        ),
      ),
      ...statements.filter((x) => !expectationCardIds.has(x.cardAccountId)).map((x) =>
        item(
          "CARD_STATEMENT",
          x.id,
          x.cardAccountId,
          x.cardAccount.name,
          x.dueDate,
          (x.reportedBalance ?? x.calculatedBalance).minus(x.paidAmount),
          x.cardAccount.currency,
          x.status,
          x.reportedBalance ? "INFORMED" : "ESTIMATED",
        ),
      ),
      ...cards
        .filter((card) => !statementCardIds.has(card.id))
        .map((card) =>
          item(
            "CARD_ESTIMATE",
            `estimate-${card.id}`,
            card.id,
            card.name,
            nextMonthlyDate(reference, card.paymentDueDay!, workspace?.timezone ?? "UTC"),
            card.currentBalance,
            card.currency,
            "PENDING",
            "ESTIMATED",
          ),
        ),
    ];
    return this.nextActionableByResource(all).slice(0, 100);
  }

  async calendarRange(workspaceId: string, from: string, to: string) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    const [installments, occurrences, statements, expectations, cards, workspace, recurring] = await Promise.all([
      this.db.debtInstallment.findMany({
        where: {
          workspaceId,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
          dueDate: { gte: start, lte: end },
        },
        include: { debts: { select: { name: true, currency: true } } },
        orderBy: { dueDate: "asc" },
      }),
      this.db.obligationOccurrence.findMany({
        where: {
          workspaceId,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
          dueDate: { gte: start, lte: end },
        },
        include: { obligation: { select: { name: true, currency: true } } },
        orderBy: { dueDate: "asc" },
      }),
      this.db.cardStatement.findMany({
        where: { workspaceId, status: { in: ["OPEN", "PARTIAL"] }, dueDate: { gte: start, lte: end } },
        include: { cardAccount: { select: { name: true, currency: true } } },
        orderBy: { dueDate: "asc" },
      }),
      this.db.cardPaymentExpectation.findMany({
        where: {
          workspaceId,
          supersededAt: null,
          status: { not: "CANCELLED" },
          dueDate: { gte: start, lte: end },
        },
        include: { cardAccount: { select: { name: true, currency: true } } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      }),
      this.db.financialAccount.findMany({
        where: {
          workspaceId,
          type: "CREDIT_CARD",
          nature: "LIABILITY",
          currentBalance: { gt: 0 },
          isActive: true,
          deletedAt: null,
          paymentDueDay: { not: null },
        },
      }),
      this.db.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } }),
      this.db.recurringObligation.findMany({
        where: { workspaceId, status: "ACTIVE", deletedAt: null },
        include: { recurrenceRules: true },
      }),
    ]);

    const expectationCardIds = new Set(expectations.map((expectation) => expectation.cardAccountId));
    const actual = [
      ...installments.map((x) => ({
        type: "DEBT_INSTALLMENT",
        resourceId: x.debtId,
        id: x.id,
        name: x.debts.name,
        date: this.dateOnly(x.dueDate),
        amount: x.totalAmount.minus(x.paidAmount).toFixed(2),
        currency: x.debts.currency,
        status: x.status,
        source: "ACTUAL",
        daysRemaining: Math.round((x.dueDate.getTime() - start.getTime()) / 86400000),
      })),
      ...occurrences.map((x) => ({
        type: "OBLIGATION",
        resourceId: x.obligationId,
        id: x.id,
        name: x.obligation.name,
        date: this.dateOnly(x.dueDate),
        amount: x.amount.minus(x.paidAmount).toFixed(2),
        currency: x.obligation.currency,
        status: x.status,
        source: "ACTUAL",
        daysRemaining: Math.round((x.dueDate.getTime() - start.getTime()) / 86400000),
      })),
      ...expectations.filter((x) => x.status !== "PAID").map((x) => ({
        type: "CARD_STATEMENT",
        resourceId: x.cardAccountId,
        id: x.id,
        name: x.cardAccount.name,
        date: this.dateOnly(x.dueDate),
        amount: x.amount.minus(x.paidAmount).toFixed(2),
        currency: x.cardAccount.currency,
        status: x.status,
        source: "INFORMED",
        daysRemaining: Math.round((x.dueDate.getTime() - start.getTime()) / 86400000),
      })),
      ...statements.filter((x) => !expectationCardIds.has(x.cardAccountId)).map((x) => ({
        type: "CARD_STATEMENT",
        resourceId: x.cardAccountId,
        id: x.id,
        name: x.cardAccount.name,
        date: this.dateOnly(x.dueDate),
        amount: (x.reportedBalance ?? x.calculatedBalance).minus(x.paidAmount).toFixed(2),
        currency: x.cardAccount.currency,
        status: x.status,
        source: x.reportedBalance ? "INFORMED" : "ESTIMATED",
        daysRemaining: Math.round((x.dueDate.getTime() - start.getTime()) / 86400000),
      })),
      ...cards
        .filter((card) => !expectationCardIds.has(card.id) && ![...statements.map((statement) => statement.cardAccountId)].includes(card.id))
        .map((card) => ({
          type: "CARD_ESTIMATE",
          resourceId: card.id,
          id: `estimate-${card.id}`,
          name: card.name,
          date: this.dateOnly(nextMonthlyDate(new Date(`${from}T00:00:00Z`), card.paymentDueDay!, workspace?.timezone ?? "UTC")),
          amount: card.currentBalance.toFixed(2),
          currency: card.currency,
          status: "PENDING",
          source: "ESTIMATED",
          daysRemaining: Math.round((new Date(`${from}T00:00:00Z`).getTime() - start.getTime()) / 86400000),
        })),
    ];

    const projected = recurring.flatMap((obligation) => {
      const rule = obligation.recurrenceRules;
      const outputs: Array<{ type: string; resourceId: string; id: string; name: string; date: string; amount: string; currency: string; status: string; source: "PROJECTED"; daysRemaining: number }> = [];
      let current = new Date(`${rule.startsOn.toISOString().slice(0, 10)}T00:00:00Z`);
      while (current < start) {
        current = this.nextOccurrenceDate(current, rule.frequency, rule.intervalValue, rule.dayOfMonth ?? undefined);
      }
      while (current <= end) {
        if (rule.endsOn && current > new Date(`${rule.endsOn.toISOString().slice(0, 10)}T00:00:00Z`)) break;
        outputs.push({
          type: "OBLIGATION",
          resourceId: obligation.id,
          id: `projected-${obligation.id}-${this.dateOnly(current)}`,
          name: obligation.name,
          date: this.dateOnly(current),
          amount: obligation.expectedAmount.toFixed(2),
          currency: obligation.currency,
          status: "PENDING",
          source: "PROJECTED",
          daysRemaining: Math.round((current.getTime() - start.getTime()) / 86400000),
        });
        current = this.nextOccurrenceDate(current, rule.frequency, rule.intervalValue, rule.dayOfMonth ?? undefined);
      }
      return outputs;
    });

    return [...actual, ...projected]
      .filter((item) => item.date >= from && item.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }

  async summary(w: string) {
    const now = new Date(),
      monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [debts, obligations, cards, payments, upcoming, debtsByCurrency] = await Promise.all([
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
      this.db.debtPayment.findMany({
        where: { workspaceId: w, reversedAt: null },
        select: {
          principalAmount: true,
          interestAmount: true,
          debts: { select: { currency: true } },
        },
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
      ...payments.map((item) => item.debts.currency),
    ]);
    const summariesByCurrency = [...currencies].sort().map((currency) => {
      const creditDebt = new Prisma.Decimal(
        debtsByCurrency.find((item) => item.currency === currency)?._sum.currentBalance ?? 0,
      );
      const cardDebt = cards
        .filter((item) => item.currency === currency)
        .reduce(
          (total, item) => total.plus(Prisma.Decimal.max(0, item.currentBalance)),
          new Prisma.Decimal(0),
        );
      const currencyPayments = payments.filter((item) => item.debts.currency === currency);
      return {
        currency,
        creditDebt: creditDebt.toFixed(2),
        cardDebt: cardDebt.toFixed(2),
        totalDebt: creditDebt.plus(cardDebt).toFixed(2),
        monthlyCommitments: sum(month.filter((item) => item.currency === currency)),
        overdueAmount: sum(overdue.filter((item) => item.currency === currency)),
        principalPaid: currencyPayments
          .reduce((total, item) => total.plus(item.principalAmount), new Prisma.Decimal(0))
          .toFixed(2),
        interestPaid: currencyPayments
          .reduce((total, item) => total.plus(item.interestAmount), new Prisma.Decimal(0))
          .toFixed(2),
      };
    });
    const cardsByCurrency = [...currencies].sort().map((currency) => {
      const currencyCards = cards.filter((card) => card.currency === currency);
      const currencyLimit = currencyCards.reduce(
        (total, card) => total.plus(card.creditLimit ?? 0),
        new Prisma.Decimal(0),
      );
      const currencyUsed = currencyCards.reduce(
        (total, card) => total.plus(Prisma.Decimal.max(0, card.currentBalance)),
        new Prisma.Decimal(0),
      );
      return {
        currency,
        creditLimit: currencyLimit.toFixed(2),
        used: currencyUsed.toFixed(2),
        available: Prisma.Decimal.max(0, currencyLimit.minus(currencyUsed)).toFixed(2),
        utilization: currencyLimit.gt(0)
          ? currencyUsed.div(currencyLimit).mul(100).toDecimalPlaces(2).toString()
          : "0",
      };
    });
    const singleCurrency = summariesByCurrency.length === 1;
    return {
      totalDebt: singleCurrency ? summariesByCurrency[0]!.totalDebt : null,
      monthlyCommitments: singleCurrency ? summariesByCurrency[0]!.monthlyCommitments : null,
      nextPayment: upcoming[0] ?? null,
      overdueAmount: singleCurrency ? summariesByCurrency[0]!.overdueAmount : null,
      principalPaid: singleCurrency ? summariesByCurrency[0]!.principalPaid : null,
      interestPaid: singleCurrency ? summariesByCurrency[0]!.interestPaid : null,
      activeDebts: debts._count,
      activeObligations: obligations,
      cards: {
        creditLimit: singleCurrency ? limit.toFixed(2) : null,
        used: singleCurrency ? used.toFixed(2) : null,
        available: singleCurrency ? Prisma.Decimal.max(0, limit.minus(used)).toFixed(2) : null,
        utilization:
          singleCurrency && limit.gt(0)
            ? used.div(limit).mul(100).toDecimalPlaces(2).toString()
            : null,
      },
      cardsByCurrency,
      summariesByCurrency,
      upcoming: upcoming.slice(0, 10),
    };
  }
}
export const liabilitiesService = new LiabilitiesService();
