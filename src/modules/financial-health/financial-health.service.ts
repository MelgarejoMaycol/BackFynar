import { Prisma } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { buildDashboardPeriod } from "../dashboard/dashboard.period.js";
import { budgetsService, type BudgetsService } from "../budgets/budgets.service.js";
import { reservationsByAccount } from "../goals/goals.reservations.js";
import {
  buildFinancialHealth,
  FINANCIAL_HEALTH_VERSION,
  type FinancialHealthResult,
} from "./financial-health.engine.js";

const D = (value: Prisma.Decimal | string | number) => new Prisma.Decimal(value);
const zero = () => D(0);
const sum = (values: Array<Prisma.Decimal | string | number>) =>
  values.reduce<Prisma.Decimal>((total, value) => total.plus(value), zero());
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const DAY = 86_400_000;
const LIQUID_TYPES = new Set(["CASH", "CHECKING", "SAVINGS", "E_WALLET"]);
const SNAPSHOT_KIND = "FINANCIAL_HEALTH_SNAPSHOT";

type Database = typeof prisma;

type SnapshotData = {
  kind: typeof SNAPSHOT_KIND;
  period: string;
  generatedAt: string;
  score: number;
  band: FinancialHealthResult["band"];
  coverage: number;
  availableDimensions: number;
  dimensions: Array<{
    id: string;
    label: string;
    score: number | null;
    status: string;
  }>;
};

const localDate = (date: Date, timezone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day", string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const daysBetween = (from: Date, to: Date) => Math.max(1, Math.floor((to.getTime() - from.getTime()) / DAY) + 1);

const asSnapshot = (value: Prisma.JsonValue): SnapshotData | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.kind !== SNAPSHOT_KIND ||
    typeof data.period !== "string" ||
    typeof data.generatedAt !== "string" ||
    typeof data.score !== "number" ||
    typeof data.band !== "string" ||
    typeof data.coverage !== "number" ||
    typeof data.availableDimensions !== "number" ||
    !Array.isArray(data.dimensions)
  )
    return null;
  return data as SnapshotData;
};

export class FinancialHealthService {
  constructor(
    private readonly database: Database = prisma,
    private readonly budgets: BudgetsService = budgetsService,
  ) {}

  private async snapshot(workspaceId: string, period: string, result: FinancialHealthResult, now: Date) {
    if (result.score === null) return;
    const candidates = await this.database.aiInsight.findMany({
      where: {
        workspaceId,
        type: "RECOMMENDATION",
        modelVersion: FINANCIAL_HEALTH_VERSION,
      },
      select: { id: true, data: true },
      orderBy: { createdAt: "desc" },
      take: 24,
    });
    const existing = candidates.find((candidate) => asSnapshot(candidate.data)?.period === period);
    const data: SnapshotData = {
      kind: SNAPSHOT_KIND,
      period,
      generatedAt: now.toISOString(),
      score: result.score,
      band: result.band,
      coverage: result.coverage,
      availableDimensions: result.availableDimensions,
      dimensions: result.dimensions.map(({ id, label, score, status }) => ({ id, label, score, status })),
    };
    const severity = result.score < 40 ? 3 : result.score < 60 ? 2 : 1;
    const confidence = D(result.coverage).div(100);
    if (existing) {
      await this.database.aiInsight.update({
        where: { id: existing.id },
        data: {
          summary: `Puntuación de salud financiera: ${result.score}/100 (${result.coverage}% de cobertura).`,
          severity,
          confidence,
          data: data as unknown as Prisma.InputJsonValue,
          validUntil: now,
          isRead: false,
          isDismissed: false,
        },
      });
      return;
    }
    await this.database.aiInsight.create({
      data: {
        workspaceId,
        type: "RECOMMENDATION",
        title: "Salud financiera",
        summary: `Puntuación de salud financiera: ${result.score}/100 (${result.coverage}% de cobertura).`,
        severity,
        confidence,
        data: data as unknown as Prisma.InputJsonValue,
        validFrom: now,
        validUntil: now,
        modelVersion: FINANCIAL_HEALTH_VERSION,
      },
    });
  }

  async history(workspaceId: string, limit = 12) {
    const rows = await this.database.aiInsight.findMany({
      where: {
        workspaceId,
        type: "RECOMMENDATION",
        modelVersion: FINANCIAL_HEALTH_VERSION,
      },
      select: { data: true },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 3, 24),
    });
    const byPeriod = new Map<string, SnapshotData>();
    for (const row of rows) {
      const snapshot = asSnapshot(row.data);
      if (snapshot && !byPeriod.has(snapshot.period)) byPeriod.set(snapshot.period, snapshot);
    }
    const items = [...byPeriod.values()]
      .sort((left, right) => left.period.localeCompare(right.period))
      .slice(-limit);
    return {
      items,
      hasEnoughHistory: items.length >= 2,
      minimumPeriods: 2,
      message:
        items.length >= 2
          ? "La evolución compara snapshots calculados con la misma fórmula y versión."
          : "El histórico aparecerá cuando existan al menos dos periodos evaluados con la misma versión.",
    };
  }

  async current(
    workspaceId: string,
    baseCurrency: string,
    timezone: string,
    now = new Date(),
  ) {
    const currency = baseCurrency.trim().toUpperCase();
    const period = buildDashboardPeriod(
      { period: "CURRENT_MONTH", recentLimit: 5 },
      timezone,
      now,
      null,
    );
    const today = localDate(now, timezone);
    const historyStart = new Date(now.getTime() - 89 * DAY);
    const paymentWindowStart = new Date(now.getTime() - 90 * DAY);
    const paymentWindowEnd = new Date(`${today}T00:00:00.000Z`);

    const [accounts, transactions, debts, reservations, currentBudgets, occurrences, installments] =
      await Promise.all([
        this.database.financialAccount.findMany({
          where: { workspaceId, currency, isActive: true, deletedAt: null },
          select: { id: true, type: true, nature: true, currentBalance: true },
        }),
        this.database.transaction.findMany({
          where: {
            workspaceId,
            currency,
            status: "CONFIRMED",
            occurredAt: { gte: historyStart, lte: now },
            type: { in: ["INCOME", "EXPENSE"] },
          },
          select: { type: true, amount: true, occurredAt: true },
          orderBy: { occurredAt: "asc" },
        }),
        this.database.debt.findMany({
          where: {
            workspaceId,
            currency,
            status: { in: ["ACTIVE", "PAUSED", "DEFAULTED"] },
            deletedAt: null,
          },
          select: { currentBalance: true, liabilityAccountId: true },
        }),
        reservationsByAccount(this.database, workspaceId),
        this.budgets.list(workspaceId, timezone, {
          includeArchived: "false",
          status: "ACTIVE",
          currency,
          dateFrom: today,
          dateTo: today,
          page: 1,
          limit: 100,
        }),
        this.database.obligationOccurrence.findMany({
          where: {
            workspaceId,
            dueDate: { gte: paymentWindowStart, lt: paymentWindowEnd },
            status: { not: "CANCELLED" },
          },
          select: { dueDate: true, status: true, paidAt: true },
        }),
        this.database.debtInstallment.findMany({
          where: {
            workspaceId,
            dueDate: { gte: paymentWindowStart, lt: paymentWindowEnd },
            status: { not: "CANCELLED" },
          },
          select: { dueDate: true, status: true, paidAt: true },
        }),
      ]);

    const reservedByAccount = new Map(reservations.map((item) => [item.accountId, item.reservedForGoals]));
    const liquidAvailable = accounts
      .filter((account) => account.nature === "ASSET" && LIQUID_TYPES.has(account.type))
      .reduce(
        (total, account) =>
          total.plus(
            Prisma.Decimal.max(
              account.currentBalance.minus(reservedByAccount.get(account.id) ?? zero()),
              0,
            ),
          ),
        zero(),
      );

    const linkedLiabilityAccounts = new Set(
      debts.flatMap((debt) => (debt.liabilityAccountId ? [debt.liabilityAccountId] : [])),
    );
    const debtBalance = sum(debts.map((debt) => Prisma.Decimal.max(debt.currentBalance, 0)));
    const standaloneLiabilities = sum(
      accounts
        .filter(
          (account) =>
            account.nature === "LIABILITY" && !linkedLiabilityAccounts.has(account.id),
        )
        .map((account) => Prisma.Decimal.max(account.currentBalance.abs(), 0)),
    );
    const totalDebt = debtBalance.plus(standaloneLiabilities);

    const firstTransactionAt = transactions[0]?.occurredAt ?? null;
    const historyDays = firstTransactionAt ? Math.min(90, daysBetween(firstTransactionAt, now)) : 0;
    const historyIncome = sum(
      transactions.filter((transaction) => transaction.type === "INCOME").map((transaction) => transaction.amount),
    );
    const historyExpenses = sum(
      transactions.filter((transaction) => transaction.type === "EXPENSE").map((transaction) => transaction.amount),
    );
    const monthlyIncomeReference =
      historyDays >= 30 ? historyIncome.div(historyDays).mul(30) : null;
    const monthlyExpenseReference =
      historyDays >= 30 ? historyExpenses.div(historyDays).mul(30) : null;

    const periodTransactions = transactions.filter(
      (transaction) => transaction.occurredAt >= period.start && transaction.occurredAt < period.endExclusive,
    );
    const periodIncome = sum(
      periodTransactions
        .filter((transaction) => transaction.type === "INCOME")
        .map((transaction) => transaction.amount),
    );
    const periodExpenses = sum(
      periodTransactions
        .filter((transaction) => transaction.type === "EXPENSE")
        .map((transaction) => transaction.amount),
    );

    const budgetItems = currentBudgets.items.filter((item) => item.currency.trim() === currency);
    const budgetAmount = sum(budgetItems.map((item) => item.amount));
    const projectedBudgetSpend = sum(budgetItems.map((item) => item.projection.projectedSpend));

    const dueItems = [...occurrences, ...installments];
    const paymentsOnTime = dueItems.filter((item) => {
      if (item.status !== "PAID" || !item.paidAt) return false;
      return localDate(item.paidAt, timezone) <= item.dueDate.toISOString().slice(0, 10);
    }).length;
    const paymentsLateOrMissed = dueItems.length - paymentsOnTime;

    const health = buildFinancialHealth({
      currency,
      liquidAvailable,
      monthlyExpenseReference,
      totalDebt,
      monthlyIncomeReference,
      budgetAmount,
      projectedBudgetSpend,
      periodIncome,
      periodExpenses,
      paymentsDue: dueItems.length,
      paymentsOnTime,
      paymentsLateOrMissed,
    });

    const periodKey = localDate(period.start, timezone).slice(0, 7);
    await this.snapshot(workspaceId, periodKey, health, now);
    const history = await this.history(workspaceId, 12);

    return {
      ...health,
      period: {
        key: periodKey,
        dateFrom: localDate(period.start, timezone),
        dateTo: localDate(new Date(period.endExclusive.getTime() - 1), timezone),
        generatedAt: now.toISOString(),
        timezone,
      },
      currency,
      dataQuality: {
        historyDays,
        trailingWindowDays: 90,
        budgetCount: budgetItems.length,
        evaluatedPayments: dueItems.length,
        notes: [
          ...(historyDays < 30
            ? ["Liquidez e ingreso de referencia necesitan al menos 30 días de historial para una comparación representativa."]
            : []),
          ...(budgetItems.length === 0
            ? ["Control del gasto queda sin puntuar hasta que exista un presupuesto activo aplicable al periodo."]
            : []),
          ...(dueItems.length === 0
            ? ["Cumplimiento de pagos queda sin puntuar cuando no existen vencimientos recientes evaluables."]
            : []),
        ],
      },
      trace: {
        liquidAvailable: fixed(liquidAvailable),
        monthlyExpenseReference: monthlyExpenseReference ? fixed(monthlyExpenseReference) : null,
        totalDebt: fixed(totalDebt),
        monthlyIncomeReference: monthlyIncomeReference ? fixed(monthlyIncomeReference) : null,
        budgetAmount: fixed(budgetAmount),
        projectedBudgetSpend: fixed(projectedBudgetSpend),
        periodIncome: fixed(periodIncome),
        periodExpenses: fixed(periodExpenses),
        paymentsDue: dueItems.length,
        paymentsOnTime,
        paymentsLateOrMissed,
      },
      history,
    };
  }
}

export const financialHealthService = new FinancialHealthService();
