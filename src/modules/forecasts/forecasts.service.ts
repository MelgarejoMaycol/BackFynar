import { Prisma } from "@prisma/client";
import { buildDashboardPeriod } from "../dashboard/dashboard.period.js";
import { liabilitiesService, type LiabilitiesService } from "../liabilities/liabilities.service.js";
import { buildMonthEndForecast, type ForecastCashEvent } from "./month-end-forecast.engine.js";
import {
  forecastsRepository,
  type ForecastsRepository,
} from "./forecasts.repository.js";

type DecimalLike = Prisma.Decimal | string | number;
const D = (value: DecimalLike) => new Prisma.Decimal(value);
const zero = () => D(0);
const sum = (values: DecimalLike[]): Prisma.Decimal => {
  let total = zero();
  for (const value of values) total = total.plus(value);
  return total;
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

const dayDiff = (from: string, to: string) =>
  Math.max(
    0,
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );

export class ForecastsService {
  constructor(
    private readonly repository: ForecastsRepository = forecastsRepository,
    private readonly liabilities: LiabilitiesService = liabilitiesService,
  ) {}

  async monthEnd(
    workspaceId: string,
    baseCurrency: string,
    timezone: string,
    now = new Date(),
  ) {
    const period = buildDashboardPeriod({ period: "CURRENT_MONTH", recentLimit: 5 }, timezone, now);
    const today = localDate(now, timezone);
    const monthEnd = localDate(new Date(period.endExclusive.getTime() - 1), timezone);
    const historyStart = new Date(now.getTime() - 60 * 86_400_000);
    const [data, liabilities] = await Promise.all([
      this.repository.readMonthEndInputs(workspaceId, now, period.endExclusive, historyStart),
      this.liabilities.upcoming(workspaceId, now),
    ]);

    const reservedByAccount = new Map(
      data.goalReservations.map((entry) => [entry.accountId, entry.reservedForGoals]),
    );
    const currencies = new Set<string>([
      baseCurrency,
      ...data.accounts.map((account) => account.currency),
      ...data.futureIncomeEvents.map((event) => event.currency),
      ...liabilities.map((item) => item.currency),
      ...data.historicalExpenses.map((expense) => expense.currency),
    ]);

    const byCurrency = [...currencies].sort().map((currency) => {
      const accounts = data.accounts.filter((account) => account.currency === currency);
      const currentAvailable = accounts.reduce(
        (total, account) =>
          total.plus(account.currentBalance).minus(reservedByAccount.get(account.id) ?? zero()),
        zero(),
      );
      const futureIncome = data.futureIncomeEvents.filter((event) => event.currency === currency);
      const commitments = liabilities.filter(
        (item) => item.currency === currency && item.date <= monthEnd,
      );
      const history = data.historicalExpenses.filter((expense) => expense.currency === currency);
      const earliestHistory = history[0]?.occurredAt;
      const historyDays = earliestHistory
        ? Math.min(60, Math.max(1, dayDiff(localDate(earliestHistory, timezone), today) + 1))
        : 0;
      const expectedIncome = sum(futureIncome.flatMap((event) => (event.amount ? [event.amount] : [])));
      const knownCommitments = sum(commitments.map((item) => item.amount));
      const historicalVariableExpense = sum(history.map((expense) => expense.amount));
      const cashEvents: ForecastCashEvent[] = [
        ...futureIncome.flatMap((event) =>
          event.amount
            ? [
                {
                  date: localDate(event.startsAt, timezone),
                  amount: event.amount,
                  direction: "IN" as const,
                  label: event.title,
                  source: "EXPECTED_INCOME" as const,
                },
              ]
            : [],
        ),
        ...commitments.map((item) => ({
          date: item.date,
          amount: item.amount,
          direction: "OUT" as const,
          label: item.name,
          source: "KNOWN_COMMITMENT" as const,
        })),
      ];
      return buildMonthEndForecast({
        currency,
        currentAvailable,
        expectedIncome,
        knownCommitments,
        historicalVariableExpense,
        historyDays,
        daysRemaining: dayDiff(today, monthEnd),
        today,
        monthEnd,
        cashEvents,
      });
    });

    const primary = byCurrency.find((item) => item.currency === baseCurrency) ?? byCurrency[0]!;
    return {
      period: {
        dateFrom: localDate(period.start, timezone),
        dateTo: monthEnd,
        generatedAt: now.toISOString(),
        timezone,
      },
      baseCurrency,
      primary,
      byCurrency,
      methodology: {
        version: "month-end-deterministic-v1",
        description:
          "Saldo libre actual + ingresos futuros explícitos - compromisos pendientes - gasto cotidiano estimado cuando existe historial suficiente.",
      },
    };
  }
}

export const forecastsService = new ForecastsService();
