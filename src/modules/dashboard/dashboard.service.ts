import { Prisma } from "@prisma/client";
import { toPublicTransaction } from "../transactions/transactions.mapper.js";
import { budgetsService, type BudgetsService } from "../budgets/budgets.service.js";
import { toDashboardAccount } from "./dashboard.mapper.js";
import { buildDashboardPeriod } from "./dashboard.period.js";
import {
  dashboardRepository,
  type DashboardReadData,
  type DashboardRepository,
} from "./dashboard.repository.js";
import type { DashboardQuery } from "./dashboard.schemas.js";
import { ValidationError } from "../../common/errors/app-error.js";
import { liabilitiesService, type LiabilitiesService } from "../liabilities/liabilities.service.js";

const zero = () => new Prisma.Decimal(0);
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
export const percentageOf = (amount: Prisma.Decimal, total: Prisma.Decimal): string =>
  total.isZero() ? "0.00" : amount.div(total).mul(100).toDecimalPlaces(2).toFixed(2);
export const calculateChange = (current: Prisma.Decimal, previous: Prisma.Decimal) => {
  const amount = current.minus(previous);
  return {
    amount: fixed(amount),
    percentage: previous.isZero() ? null : percentageOf(amount, previous.abs()),
  };
};

interface CurrencyTotals {
  income: Prisma.Decimal;
  expenses: Prisma.Decimal;
}

const localDate = (date: Date, timezone: string): string => {
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
const totalsMap = (rows: DashboardReadData["currentTotals"]): Map<string, CurrencyTotals> => {
  const result = new Map<string, CurrencyTotals>();
  for (const row of rows) {
    const totals = result.get(row.currency) ?? { income: zero(), expenses: zero() };
    if (row.type === "INCOME") totals.income = row._sum.amount ?? zero();
    if (row.type === "EXPENSE") totals.expenses = row._sum.amount ?? zero();
    result.set(row.currency, totals);
  }
  return result;
};

export class DashboardService {
  constructor(
    private readonly repository: DashboardRepository = dashboardRepository,
    private readonly budgets: BudgetsService = budgetsService,
    private readonly liabilities: LiabilitiesService = liabilitiesService,
  ) {}
  async get(
    workspaceId: string,
    baseCurrency: string,
    timezone: string,
    query: DashboardQuery,
    now = new Date(),
    userId?: string,
  ) {
    const financialCycleStartDay =
      query.period === "MY_CYCLE" && userId
        ? await this.repository.financialCycleStartDay(userId)
        : null;
    if (query.period === "MY_CYCLE" && !financialCycleStartDay)
      throw new ValidationError(
        "Configura el día de inicio de tu ciclo financiero antes de usar Mi ciclo.",
      );
    const period = buildDashboardPeriod(query, timezone, now, financialCycleStartDay);
    const forecastStart = localDate(now, timezone);
    const [forecastYear, forecastMonth] = forecastStart.split("-").map(Number);
    const forecastEnd = new Date(Date.UTC(forecastYear!, forecastMonth!, 0))
      .toISOString()
      .slice(0, 10);
    const [data, budgetPage, loanCollections, scheduledItems] = await Promise.all([
      this.repository.read(workspaceId, period, query.recentLimit),
      this.budgets.list(workspaceId, timezone, {
        includeArchived: "false",
        dateFrom: localDate(period.start, timezone),
        dateTo: localDate(new Date(period.endExclusive.getTime() - 1), timezone),
        page: 1,
        limit: 100,
      }),
      this.repository.loanCollections(workspaceId, forecastStart, forecastEnd),
      this.liabilities.calendarRange(workspaceId, forecastStart, forecastEnd),
    ]);
    const sourcePriority: Record<string, number> = {
      ACTUAL: 0,
      INFORMED: 1,
      ESTIMATED: 2,
      SCHEDULED: 3,
      PROJECTED: 4,
    };
    const scheduledByResourceDate = new Map<string, (typeof scheduledItems)[number]>();
    for (const item of scheduledItems) {
      const key = `${item.resourceId}:${item.date}`;
      const currentItem = scheduledByResourceDate.get(key);
      if (
        !currentItem ||
        (sourcePriority[item.source] ?? 99) < (sourcePriority[currentItem.source] ?? 99)
      ) {
        scheduledByResourceDate.set(key, item);
      }
    }
    const scheduled = [...scheduledByResourceDate.values()];
    const current = totalsMap(data.currentTotals);
    const previous = totalsMap(data.previousTotals);
    const reservedByAccount = new Map(
      data.goalReservations.map((entry) => [entry.accountId, entry.reservedForGoals]),
    );
    const currencies = new Set<string>([
      baseCurrency,
      ...data.accounts.map((account) => account.currency),
      ...data.receivables.map((account) => account.currency),
      ...loanCollections.map((item) => item.currency),
      ...scheduled.map((item) => item.currency),
      ...current.keys(),
      ...previous.keys(),
    ]);
    const summariesByCurrency = [...currencies].sort().map((currency) => {
      const totals = current.get(currency) ?? { income: zero(), expenses: zero() };
      const accounts = data.accounts.filter((account) => account.currency === currency);
      const totalMoney = accounts
        .filter((account) => account.nature === "ASSET")
        .reduce((sum, account) => sum.plus(account.currentBalance), zero());
      const reservedForGoals = accounts
        .filter((account) => account.nature === "ASSET")
        .reduce((sum, account) => sum.plus(reservedByAccount.get(account.id) ?? zero()), zero());
      const availableMoney = totalMoney.minus(reservedForGoals);
      const receivableBalance =
        data.receivables.find((item) => item.currency === currency)?._sum.currentBalance ?? zero();
      const netWorth = accounts
        .filter((account) => account.includeInNetWorth)
        .reduce(
          (sum, account) =>
            account.nature === "ASSET"
              ? sum.plus(account.currentBalance)
              : sum.minus(account.currentBalance.abs()),
          zero(),
        )
        .plus(receivableBalance);
      const expectedCollections =
        loanCollections.find((item) => item.currency === currency)?.amount ?? zero();
      const scheduledPayments = scheduled
        .filter((item) => item.currency === currency)
        .reduce((sum, item) => sum.plus(item.amount), zero());
      return {
        currency,
        ...(reservedForGoals.isZero()
          ? {}
          : {
              totalMoney: fixed(totalMoney),
              reservedForGoals: fixed(reservedForGoals),
            }),
        availableMoney: fixed(availableMoney),
        totalIncome: fixed(totals.income),
        totalExpenses: fixed(totals.expenses),
        netCashFlow: fixed(totals.income.minus(totals.expenses)),
        netWorth: fixed(netWorth),
        expectedCollections: fixed(expectedCollections),
        scheduledPayments: fixed(scheduledPayments),
        projectedEndLiquidity: fixed(
          availableMoney.plus(expectedCollections).minus(scheduledPayments),
        ),
        forecastDate: forecastEnd,
      };
    });
    const categoryById = new Map(data.categories.map((category) => [category.id, category]));
    const expensesByCategory = data.expenses
      .map((row) => {
        const amount = row._sum.amount ?? zero();
        const category = row.categoryId ? categoryById.get(row.categoryId) : undefined;
        return {
          categoryId: row.categoryId,
          categoryName: category?.name ?? "Sin categoría",
          icon: category?.icon ?? null,
          color: category?.color ?? null,
          currency: row.currency,
          amount: fixed(amount),
          percentage: percentageOf(amount, current.get(row.currency)?.expenses ?? zero()),
          amountValue: amount,
        };
      })
      .sort(
        (left, right) =>
          left.currency.localeCompare(right.currency) ||
          right.amountValue.comparedTo(left.amountValue) ||
          left.categoryName.localeCompare(right.categoryName) ||
          (left.categoryId ?? "").localeCompare(right.categoryId ?? ""),
      )
      .map(({ amountValue: _amountValue, ...item }) => item);
    const accountGroups = new Map<
      string,
      {
        type: string;
        nature: string;
        currency: string;
        accountCount: number;
        total: Prisma.Decimal;
      }
    >();
    for (const account of data.accounts) {
      const key = `${account.type}:${account.nature}:${account.currency}`;
      const group = accountGroups.get(key) ?? {
        type: account.type,
        nature: account.nature,
        currency: account.currency,
        accountCount: 0,
        total: zero(),
      };
      group.accountCount += 1;
      group.total = group.total.plus(account.currentBalance);
      accountGroups.set(key, group);
    }
    const accountsByType = [...accountGroups.values()]
      .sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          a.nature.localeCompare(b.nature) ||
          a.currency.localeCompare(b.currency),
      )
      .map(({ total, ...group }) => ({ ...group, totalBalance: fixed(total) }));
    const comparisonByCurrency = [...currencies].sort().map((currency) => {
      const currentValue = current.get(currency) ?? { income: zero(), expenses: zero() };
      const previousValue = previous.get(currency) ?? { income: zero(), expenses: zero() };
      const incomeChange = calculateChange(currentValue.income, previousValue.income);
      const expenseChange = calculateChange(currentValue.expenses, previousValue.expenses);
      return {
        currency,
        currentIncome: fixed(currentValue.income),
        previousIncome: fixed(previousValue.income),
        incomeChangeAmount: incomeChange.amount,
        incomeChangePercentage: incomeChange.percentage,
        currentExpenses: fixed(currentValue.expenses),
        previousExpenses: fixed(previousValue.expenses),
        expenseChangeAmount: expenseChange.amount,
        expenseChangePercentage: expenseChange.percentage,
        currentNetCashFlow: fixed(currentValue.income.minus(currentValue.expenses)),
        previousNetCashFlow: fixed(previousValue.income.minus(previousValue.expenses)),
      };
    });
    return {
      period: {
        type: period.type,
        dateFrom: period.start.toISOString(),
        dateTo: new Date(period.endExclusive.getTime() - 1).toISOString(),
        timezone,
      },
      baseCurrency,
      summariesByCurrency,
      accountBalances: data.accounts.map((account) => {
        const base = toDashboardAccount(account);
        const reserved =
          account.nature === "ASSET" ? (reservedByAccount.get(account.id) ?? zero()) : zero();
        return {
          ...base,
          reservedForGoals: fixed(reserved),
          availableBalance: fixed(
            account.nature === "ASSET"
              ? account.currentBalance.minus(reserved)
              : account.currentBalance,
          ),
        };
      }),
      recentTransactions: data.recentTransactions.map(toPublicTransaction),
      budgetProgress: budgetPage.items,
      expensesByCategory,
      accountsByType,
      comparisonByCurrency,
    };
  }
}

export const dashboardService = new DashboardService();
