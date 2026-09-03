import { Prisma } from "@prisma/client";
import { buildDashboardPeriod } from "../dashboard/dashboard.period.js";
import { liabilitiesService, type LiabilitiesService } from "../liabilities/liabilities.service.js";
import { usersRepository, type UsersRepository } from "../users/users.repository.js";
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

type ProjectionPreference = {
  mode: "MONTH_END" | "CYCLE_END";
  expectedMonthlyIncome: string | null;
  payDay: number | null;
  enabled: boolean;
};

const projectionPreference = (layout: Prisma.JsonValue): ProjectionPreference => {
  const fallback: ProjectionPreference = {
    mode: "MONTH_END",
    expectedMonthlyIncome: null,
    payDay: null,
    enabled: false,
  };
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return fallback;
  const raw = (layout as Record<string, unknown>).projection;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const value = raw as Record<string, unknown>;
  const mode = value.mode === "CYCLE_END" ? "CYCLE_END" : "MONTH_END";
  const amount =
    typeof value.expectedMonthlyIncome === "string" &&
    /^\d+(?:\.\d{1,2})?$/.test(value.expectedMonthlyIncome)
      ? value.expectedMonthlyIncome
      : null;
  const payDay =
    typeof value.payDay === "number" && Number.isInteger(value.payDay) && value.payDay >= 1 && value.payDay <= 28
      ? value.payDay
      : null;
  return {
    mode,
    expectedMonthlyIncome: amount,
    payDay,
    enabled: value.enabled === true && amount !== null && payDay !== null,
  };
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

const expectedPayDate = (today: string, periodStart: string, periodEnd: string, payDay: number) => {
  const [startYear, startMonth] = periodStart.split("-").map(Number);
  const [endYear, endMonth] = periodEnd.split("-").map(Number);
  const candidates: string[] = [];
  for (let year = startYear!; year <= endYear!; year += 1) {
    const firstMonth = year === startYear ? startMonth! : 1;
    const lastMonth = year === endYear ? endMonth! : 12;
    for (let month = firstMonth; month <= lastMonth; month += 1) {
      candidates.push(`${year}-${String(month).padStart(2, "0")}-${String(payDay).padStart(2, "0")}`);
    }
  }
  return candidates.find((date) => date >= today && date >= periodStart && date <= periodEnd) ?? null;
};

export class ForecastsService {
  constructor(
    private readonly repository: ForecastsRepository = forecastsRepository,
    private readonly liabilities: LiabilitiesService = liabilitiesService,
    private readonly users: UsersRepository = usersRepository,
  ) {}

  async monthEnd(
    workspaceId: string,
    baseCurrency: string,
    timezone: string,
    userId: string,
    now = new Date(),
  ) {
    const preferences = await this.users.ensurePreferences(userId);
    const projection = projectionPreference(preferences.dashboardLayout);
    const useCycle = projection.mode === "CYCLE_END" && Boolean(preferences.financialCycleStartDay);
    const period = buildDashboardPeriod(
      { period: useCycle ? "MY_CYCLE" : "CURRENT_MONTH", recentLimit: 5 },
      timezone,
      now,
      useCycle ? preferences.financialCycleStartDay : null,
    );
    const today = localDate(now, timezone);
    const periodStart = localDate(period.start, timezone);
    const periodEnd = localDate(new Date(period.endExclusive.getTime() - 1), timezone);
    const historyStart = new Date(now.getTime() - 60 * 86_400_000);
    const [data, liabilities] = await Promise.all([
      this.repository.readMonthEndInputs(workspaceId, now, period.endExclusive, historyStart),
      this.liabilities.upcoming(workspaceId, now),
    ]);

    const configuredPayDate =
      projection.enabled && projection.payDay
        ? expectedPayDate(today, periodStart, periodEnd, projection.payDay)
        : null;
    const configuredIncome =
      configuredPayDate && projection.expectedMonthlyIncome
        ? {
            date: configuredPayDate,
            amount: D(projection.expectedMonthlyIncome),
            currency: baseCurrency,
            label: "Sueldo esperado",
          }
        : null;

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
      const salaryAlreadyRepresented =
        configuredIncome?.currency === currency &&
        futureIncome.some(
          (event) =>
            event.amount &&
            localDate(event.startsAt, timezone) === configuredIncome.date &&
            D(event.amount).equals(configuredIncome.amount),
        );
      const salary =
        configuredIncome?.currency === currency && !salaryAlreadyRepresented ? configuredIncome : null;
      const commitments = liabilities.filter(
        (item) => item.currency === currency && item.date <= periodEnd,
      );
      const history = data.historicalExpenses.filter((expense) => expense.currency === currency);
      const earliestHistory = history[0]?.occurredAt;
      const historyDays = earliestHistory
        ? Math.min(60, Math.max(1, dayDiff(localDate(earliestHistory, timezone), today) + 1))
        : 0;
      const expectedIncome = sum([
        ...futureIncome.flatMap((event) => (event.amount ? [event.amount] : [])),
        ...(salary ? [salary.amount] : []),
      ]);
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
        ...(salary
          ? [
              {
                date: salary.date,
                amount: salary.amount,
                direction: "IN" as const,
                label: salary.label,
                source: "EXPECTED_INCOME" as const,
              },
            ]
          : []),
        ...commitments.map((item) => ({
          date: item.date,
          amount: item.amount,
          direction: "OUT" as const,
          label: item.name,
          source: "KNOWN_COMMITMENT" as const,
        })),
      ];
      const result = buildMonthEndForecast({
        currency,
        currentAvailable,
        expectedIncome,
        knownCommitments,
        historicalVariableExpense,
        historyDays,
        daysRemaining: dayDiff(today, periodEnd),
        today,
        monthEnd: periodEnd,
        cashEvents,
      });
      return {
        ...result,
        assumptions: [
          ...result.assumptions,
          ...(salary ? [`Se incluyó ${salary.label.toLowerCase()} para el ${salary.date}.`] : []),
        ],
      };
    });

    const primary = byCurrency.find((item) => item.currency === baseCurrency) ?? byCurrency[0]!;
    return {
      period: {
        type: useCycle ? "CYCLE_END" : "MONTH_END",
        dateFrom: periodStart,
        dateTo: periodEnd,
        generatedAt: now.toISOString(),
        timezone,
      },
      baseCurrency,
      primary,
      byCurrency,
      configuredIncome: configuredIncome
        ? {
            amount: configuredIncome.amount.toFixed(2),
            currency: configuredIncome.currency,
            date: configuredIncome.date,
            label: configuredIncome.label,
          }
        : null,
      methodology: {
        version: "period-close-deterministic-v2",
        description:
          "Saldo libre actual + ingresos futuros conocidos o configurados - compromisos pendientes - gasto cotidiano estimado cuando existe historial suficiente.",
      },
    };
  }
}

export const forecastsService = new ForecastsService();
