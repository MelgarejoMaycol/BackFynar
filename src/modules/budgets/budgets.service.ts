import { Prisma, type budget_period } from "@prisma/client";
import { AppError, ConflictError, ValidationError } from "../../common/errors/app-error.js";
import { dateOnly, projectionDays } from "./budgets.dates.js";
import type { BudgetRecord } from "./budgets.mapper.js";
import { budgetsRepository, type BudgetsRepository } from "./budgets.repository.js";
import type { CreateBudgetInput, ListBudgetsInput, UpdateBudgetInput } from "./budgets.schemas.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import { buildDashboardPeriod } from "../dashboard/dashboard.period.js";
import { dashboardRepository } from "../dashboard/dashboard.repository.js";

const notFound = () =>
  new AppError("Presupuesto no encontrado", {
    status: 404,
    code: "BUDGET_NOT_FOUND",
    publicMessage: "Presupuesto no encontrado",
  });
const associationConflict = () =>
  new ConflictError(
    "Asociación de presupuesto duplicada",
    "El presupuesto contiene una asociación duplicada",
  );
const isUniqueConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const decimal = (v: string) => new Prisma.Decimal(v);
const fixed = (v: Prisma.Decimal) => v.toDecimalPlaces(2).toFixed(2);
const localDateOnly = (value: Date, timezone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export type BudgetStatus = "SAFE" | "WARNING" | "EXCEEDED";
export const budgetStatus = (
  spent: Prisma.Decimal,
  amount: Prisma.Decimal,
  threshold: Prisma.Decimal,
): BudgetStatus =>
  spent.gt(amount) ? "EXCEEDED" : spent.div(amount).mul(100).gte(threshold) ? "WARNING" : "SAFE";
export const budgetProgress = (
  spent: Prisma.Decimal,
  amount: Prisma.Decimal,
  threshold: Prisma.Decimal,
  days: { elapsed: number; total: number; phase: "BEFORE" | "DURING" | "AFTER" },
) => {
  const percentage = spent.div(amount).mul(100);
  const projected =
    days.phase === "BEFORE"
      ? new Prisma.Decimal(0)
      : days.phase === "AFTER"
        ? spent
        : spent.div(days.elapsed).mul(days.total);
  return {
    progress: {
      spent: fixed(spent),
      remaining: fixed(amount.minus(spent)),
      percentage: fixed(percentage),
      status: budgetStatus(spent, amount, threshold),
    },
    projection: {
      projectedSpend: fixed(projected),
      projectedRemaining: fixed(amount.minus(projected)),
      projectedPercentage: fixed(projected.div(amount).mul(100)),
      projectedStatus: budgetStatus(projected, amount, threshold),
    },
  };
};
const publicBudget = (
  budget: BudgetRecord,
  spent: Prisma.Decimal,
  timezone: string,
  now = new Date(),
) => ({
  id: budget.id,
  name: budget.name,
  period: budget.period,
  startsOn: dateOnly(budget.startsOn),
  endsOn: dateOnly(budget.endsOn),
  amount: fixed(budget.amount),
  currency: budget.currency.trim(),
  alertThreshold: fixed(budget.alertThreshold),
  rolloverEnabled: budget.rolloverEnabled,
  isActive: budget.isActive,
  categories: budget.budgetCategories.map(({ categories: c }) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    icon: c.icon,
    color: c.color,
    isSystem: c.isSystem,
    isActive: c.isActive,
  })),
  accounts: budget.budgetAccounts.map(({ financialAccounts: a }) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    nature: a.nature,
    currency: a.currency.trim(),
    isActive: a.isActive,
  })),
  ...budgetProgress(
    spent,
    budget.amount,
    budget.alertThreshold,
    projectionDays(dateOnly(budget.startsOn), dateOnly(budget.endsOn), timezone, now),
  ),
  createdAt: budget.createdAt.toISOString(),
  updatedAt: budget.updatedAt.toISOString(),
});
const validatePeriod = (period: budget_period, startsOn: string, endsOn: string) => {
  if (startsOn > endsOn) throw new ValidationError("Rango de presupuesto inválido");
  const start = new Date(`${startsOn}T00:00:00Z`),
    end = new Date(`${endsOn}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (period === "WEEKLY" && days !== 7)
    throw new ValidationError("WEEKLY debe contener exactamente 7 días");
  if (
    period === "MONTHLY" &&
    (start.getUTCDate() !== 1 ||
      start.getUTCFullYear() !== end.getUTCFullYear() ||
      start.getUTCMonth() !== end.getUTCMonth() ||
      end.getUTCDate() !==
        new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate())
  )
    throw new ValidationError("MONTHLY debe cubrir un mes calendario completo");
  if (
    period === "YEARLY" &&
    (startsOn !== `${start.getUTCFullYear()}-01-01` || endsOn !== `${start.getUTCFullYear()}-12-31`)
  )
    throw new ValidationError("YEARLY debe cubrir un año calendario completo");
};
export class BudgetsService {
  constructor(private readonly repository: BudgetsRepository = budgetsRepository) {}
  async cycleRange(userId: string, timezone: string, now = new Date()) {
    const startDay = await dashboardRepository.financialCycleStartDay(userId);
    if (!startDay)
      throw new ConflictError(
        "Mi ciclo no está configurado",
        "Configura Mi ciclo para utilizar este período.",
      );
    const period = buildDashboardPeriod(
      { period: "MY_CYCLE", recentLimit: 1 },
      timezone,
      now,
      startDay,
    );
    return {
      startsOn: localDateOnly(period.start, timezone),
      endsOn: localDateOnly(new Date(period.endExclusive.getTime() - 1), timezone),
      financialCycleStartDay: startDay,
    };
  }
  private async validateAssociations(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    currency: string,
    categoryIds: string[],
    accountIds: string[],
    activeOnly = true,
  ) {
    const [categories, accounts] = await Promise.all([
      tx.category.findMany({
        where: {
          id: { in: categoryIds },
          type: "EXPENSE",
          ...(activeOnly ? { isActive: true, deletedAt: null } : {}),
          OR: [
            { workspaceId: null, isSystem: true },
            { workspaceId, isSystem: false },
          ],
        },
        select: { id: true },
      }),
      tx.financialAccount.findMany({
        where: {
          id: { in: accountIds },
          workspaceId,
          currency,
          ...(activeOnly ? { isActive: true, deletedAt: null } : {}),
        },
        select: { id: true },
      }),
    ]);
    if (categories.length !== categoryIds.length)
      throw new AppError("Categoría incompatible", {
        status: 404,
        code: "CATEGORY_NOT_FOUND",
        publicMessage: "Categoría no encontrada",
      });
    if (accounts.length !== accountIds.length)
      throw new AppError("Cuenta incompatible", {
        status: 404,
        code: "ACCOUNT_NOT_FOUND",
        publicMessage: "Cuenta no encontrada o incompatible con la moneda",
      });
  }
  async create(workspaceId: string, timezone: string, input: CreateBudgetInput) {
    validatePeriod(input.period, input.startsOn, input.endsOn);
    let createdId: string;
    try {
      createdId = await this.repository.transaction(async (tx) => {
        await this.validateAssociations(
          tx,
          workspaceId,
          input.currency,
          input.categoryIds,
          input.accountIds,
        );
        return (await this.repository.create(tx, workspaceId, input)).id;
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw associationConflict();
      throw error;
    }
    return this.get(workspaceId, createdId, timezone);
  }
  async list(workspaceId: string, timezone: string, filters: ListBudgetsInput) {
    const [rows, total] = await this.repository.list(workspaceId, filters);
    const spending = new Map(
      (
        await this.repository.spending(
          workspaceId,
          rows.map((r) => r.id),
        )
      ).map((r) => [r.budgetId, r.spent]),
    );
    return {
      items: rows.map((r) =>
        publicBudget(r, spending.get(r.id) ?? new Prisma.Decimal(0), timezone),
      ),
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    };
  }
  async get(workspaceId: string, id: string, timezone: string) {
    const row = await this.repository.find(workspaceId, id);
    if (!row) throw notFound();
    const spent =
      (await this.repository.spending(workspaceId, [id]))[0]?.spent ?? new Prisma.Decimal(0);
    return publicBudget(row, spent, timezone);
  }
  async update(workspaceId: string, id: string, timezone: string, input: UpdateBudgetInput) {
    try {
      await this.repository.transaction(async (tx) => {
        const current = await this.repository.find(workspaceId, id, tx);
        if (!current) throw notFound();
        if (current.deletedAt)
          throw new ConflictError(
            "Presupuesto archivado",
            "Restaure el presupuesto antes de editarlo",
          );
        const startsOn = input.startsOn ?? dateOnly(current.startsOn),
          endsOn = input.endsOn ?? dateOnly(current.endsOn),
          period = input.period ?? current.period,
          currency = input.currency ?? current.currency.trim();
        validatePeriod(period, startsOn, endsOn);
        const categoryIds = input.categoryIds ?? current.budgetCategories.map((x) => x.categoryId),
          accountIds = input.accountIds ?? current.budgetAccounts.map((x) => x.accountId);
        await this.validateAssociations(tx, workspaceId, currency, categoryIds, accountIds);
        await tx.budget.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.period !== undefined ? { period: input.period } : {}),
            ...(input.startsOn !== undefined
              ? { startsOn: new Date(`${input.startsOn}T00:00:00Z`) }
              : {}),
            ...(input.endsOn !== undefined
              ? { endsOn: new Date(`${input.endsOn}T00:00:00Z`) }
              : {}),
            ...(input.amount !== undefined ? { amount: decimal(input.amount) } : {}),
            ...(input.currency !== undefined ? { currency } : {}),
            ...(input.alertThreshold !== undefined
              ? { alertThreshold: decimal(input.alertThreshold) }
              : {}),
            ...(input.rolloverEnabled !== undefined
              ? { rolloverEnabled: input.rolloverEnabled }
              : {}),
            ...(input.categoryIds !== undefined
              ? {
                  budgetCategories: {
                    deleteMany: {},
                    create: categoryIds.map((categoryId) => ({ categoryId })),
                  },
                }
              : {}),
            ...(input.accountIds !== undefined
              ? {
                  budgetAccounts: {
                    deleteMany: {},
                    create: accountIds.map((accountId) => ({ accountId })),
                  },
                }
              : {}),
          },
        });
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw associationConflict();
      throw error;
    }
    return this.get(workspaceId, id, timezone);
  }
  async archive(workspaceId: string, userId: string, id: string) {
    return this.repository.transaction(async (tx) => {
      const existing = await this.repository.find(workspaceId, id, tx);
      if (!existing || existing.deletedAt) throw notFound();
      await recordDeletionAudit(tx, {
        workspaceId,
        userId,
        entityType: "BUDGET",
        entityId: id,
        mode: "LOGICAL",
        name: existing.name,
      });
      await tx.budget.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
      return { mode: "LOGICAL" as const };
    });
  }
  async restore(workspaceId: string, id: string, timezone: string) {
    await this.repository.transaction(async (tx) => {
      const current = await this.repository.find(workspaceId, id, tx);
      if (!current) throw notFound();
      if (!current.deletedAt) return;
      validatePeriod(current.period, dateOnly(current.startsOn), dateOnly(current.endsOn));
      await this.validateAssociations(
        tx,
        workspaceId,
        current.currency.trim(),
        current.budgetCategories.map((x) => x.categoryId),
        current.budgetAccounts.map((x) => x.accountId),
      );
      await tx.budget.update({ where: { id }, data: { isActive: true, deletedAt: null } });
    });
    return this.get(workspaceId, id, timezone);
  }
}
export const budgetsService = new BudgetsService();
