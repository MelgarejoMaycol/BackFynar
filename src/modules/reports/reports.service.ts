import { Prisma } from "@prisma/client";
import { NotFoundError } from "../../common/errors/app-error.js";
import { reportChange, reportFixed, reportPercentage } from "./reports.mapper.js";
import {
  buildBuckets,
  buildReportPeriod,
  localIso,
  resolveGroup,
  type ReportBucket,
} from "./reports.period.js";
import {
  reportsRepository,
  type DailyRow,
  type ReportsRepository,
  type TotalRow,
} from "./reports.repository.js";
import type {
  AccountBalancesReportQuery,
  CashFlowReportQuery,
  CategoryReportQuery,
  CommonReportQuery,
} from "./reports.schemas.js";

const zero = () => new Prisma.Decimal(0);

interface Totals {
  income: Prisma.Decimal;
  expenses: Prisma.Decimal;
  incomeCount: number;
  expenseCount: number;
}

const emptyTotals = (): Totals => ({
  income: zero(),
  expenses: zero(),
  incomeCount: 0,
  expenseCount: 0,
});

function totalsByCurrency(rows: TotalRow[]): Map<string, Totals> {
  const result = new Map<string, Totals>();
  for (const row of rows) {
    const totals = result.get(row.currency) ?? emptyTotals();
    if (row.type === "INCOME") {
      totals.income = row.amount;
      totals.incomeCount = row.count;
    } else {
      totals.expenses = row.amount;
      totals.expenseCount = row.count;
    }
    result.set(row.currency, totals);
  }
  return result;
}

const average = (amount: Prisma.Decimal, count: number) =>
  count === 0 ? reportFixed(zero()) : reportFixed(amount.div(count));

function reportPeriod(period: ReturnType<typeof buildReportPeriod>) {
  return {
    type: period.type,
    dateFrom: period.start.toISOString(),
    dateTo: new Date(period.endExclusive.getTime() - 1).toISOString(),
    timezone: period.timezone,
  };
}

function rawLocalDate(value: Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function bucketFor(row: DailyRow, buckets: ReportBucket[]): number {
  const value = rawLocalDate(row.localDate);
  return buckets.findIndex(
    (bucket) => value >= localIso(bucket.startLocal) && value < localIso(bucket.endLocalExclusive),
  );
}

export class ReportsService {
  constructor(private readonly repository: ReportsRepository = reportsRepository) {}

  private async validateFilters(workspaceId: string, query: CommonReportQuery): Promise<void> {
    const [account, category] = await Promise.all([
      query.accountId ? this.repository.validateAccount(workspaceId, query.accountId) : true,
      query.categoryId ? this.repository.validateCategory(workspaceId, query.categoryId) : true,
    ]);
    if (!account) throw new NotFoundError("Cuenta de reporte inexistente", "Cuenta no encontrada");
    if (!category)
      throw new NotFoundError("Categoría de reporte inexistente", "Categoría no encontrada");
  }

  async incomeVsExpenses(
    workspaceId: string,
    timezone: string,
    query: CommonReportQuery,
    now = new Date(),
  ) {
    await this.validateFilters(workspaceId, query);
    const period = buildReportPeriod(query, timezone, now);
    const [currentRows, previousRows] = await Promise.all([
      this.repository.totals(workspaceId, period, query),
      this.repository.totals(workspaceId, period, query, true),
    ]);
    const current = totalsByCurrency(currentRows);
    const previous = totalsByCurrency(previousRows);
    const currencies = new Set([...current.keys(), ...previous.keys()]);
    if (query.currency) currencies.add(query.currency);
    return {
      period: reportPeriod(period),
      summariesByCurrency: [...currencies].sort().map((currency) => {
        const value = current.get(currency) ?? emptyTotals();
        const old = previous.get(currency) ?? emptyTotals();
        const net = value.income.minus(value.expenses);
        const oldNet = old.income.minus(old.expenses);
        return {
          currency,
          totalIncome: reportFixed(value.income),
          totalExpenses: reportFixed(value.expenses),
          netCashFlow: reportFixed(net),
          incomeTransactionCount: value.incomeCount,
          expenseTransactionCount: value.expenseCount,
          averageIncome: average(value.income, value.incomeCount),
          averageExpense: average(value.expenses, value.expenseCount),
          comparisonWithPreviousPeriod: {
            currentIncome: reportFixed(value.income),
            previousIncome: reportFixed(old.income),
            incomeChangeAmount: reportChange(value.income, old.income).amount,
            incomeChangePercentage: reportChange(value.income, old.income).percentage,
            currentExpenses: reportFixed(value.expenses),
            previousExpenses: reportFixed(old.expenses),
            expenseChangeAmount: reportChange(value.expenses, old.expenses).amount,
            expenseChangePercentage: reportChange(value.expenses, old.expenses).percentage,
            currentNetCashFlow: reportFixed(net),
            previousNetCashFlow: reportFixed(oldNet),
            netCashFlowChangeAmount: reportChange(net, oldNet).amount,
            netCashFlowChangePercentage: reportChange(net, oldNet).percentage,
          },
        };
      }),
    };
  }

  async expensesByCategory(
    workspaceId: string,
    timezone: string,
    query: CategoryReportQuery,
    now = new Date(),
  ) {
    await this.validateFilters(workspaceId, query);
    const period = buildReportPeriod(query, timezone, now);
    const rows = await this.repository.categories(workspaceId, period, query);
    const currencies = new Set(rows.map((row) => row.currency));
    if (query.currency) currencies.add(query.currency);
    return {
      period: reportPeriod(period),
      groupsByCurrency: [...currencies].sort().map((currency) => {
        const currencyRows = rows.filter((row) => row.currency === currency);
        const total = currencyRows.reduce((sum, row) => sum.plus(row.amount), zero());
        return {
          currency,
          totalExpenses: reportFixed(total),
          categories: currencyRows.slice(0, query.limit).map((row) => ({
            categoryId: row.categoryId,
            categoryName: row.categoryName ?? "Sin categoría",
            icon: row.icon,
            color: row.color,
            amount: reportFixed(row.amount),
            percentage: reportPercentage(row.amount, total),
            transactionCount: row.count,
          })),
        };
      }),
    };
  }

  async cashFlow(
    workspaceId: string,
    timezone: string,
    query: CashFlowReportQuery,
    now = new Date(),
  ) {
    await this.validateFilters(workspaceId, query);
    const period = buildReportPeriod(query, timezone, now);
    const groupBy = resolveGroup(query, period);
    const [rows, buckets] = await Promise.all([
      this.repository.daily(workspaceId, period, query),
      Promise.resolve(buildBuckets(period, groupBy)),
    ]);
    const currencies = new Set(rows.map((row) => row.currency));
    if (query.currency) currencies.add(query.currency);
    return {
      period: reportPeriod(period),
      groupBy,
      seriesByCurrency: [...currencies].sort().map((currency) => {
        const points = buckets.map((bucket) => ({
          periodStart: bucket.start.toISOString(),
          periodEnd: new Date(bucket.endExclusive.getTime() - 1).toISOString(),
          income: zero(),
          expenses: zero(),
          incomeTransactionCount: 0,
          expenseTransactionCount: 0,
        }));
        for (const row of rows.filter((item) => item.currency === currency)) {
          const index = bucketFor(row, buckets);
          const point = points[index];
          if (!point) continue;
          if (row.type === "INCOME") {
            point.income = point.income.plus(row.amount);
            point.incomeTransactionCount += row.count;
          } else {
            point.expenses = point.expenses.plus(row.amount);
            point.expenseTransactionCount += row.count;
          }
        }
        return {
          currency,
          points: points.map((point) => ({
            periodStart: point.periodStart,
            periodEnd: point.periodEnd,
            totalIncome: reportFixed(point.income),
            totalExpenses: reportFixed(point.expenses),
            netCashFlow: reportFixed(point.income.minus(point.expenses)),
            incomeCount: point.incomeTransactionCount,
            expenseCount: point.expenseTransactionCount,
          })),
        };
      }),
    };
  }

  async accountBalances(workspaceId: string, query: AccountBalancesReportQuery) {
    const [accounts, total, summaries] = await this.repository.accounts(workspaceId, query);
    return {
      summariesByCurrency: summaries.map((summary) => ({
        ...summary,
        assetBalance: reportFixed(summary.assetBalance),
        liabilityBalance: reportFixed(summary.liabilityBalance),
        netWorth: reportFixed(summary.netWorth),
        availableMoney: reportFixed(summary.availableMoney),
      })),
      accounts: accounts.map((account) => ({
        ...account,
        currentBalance: reportFixed(account.currentBalance),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}

export const reportsService = new ReportsService();
