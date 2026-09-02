import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { budgetSelect } from "./budgets.mapper.js";
import type { CreateBudgetInput, ListBudgetsInput } from "./budgets.schemas.js";

export interface SpendingRow {
  budgetId: string;
  spent: Prisma.Decimal;
}

export interface BudgetMovementRow {
  id: string;
  amount: Prisma.Decimal;
  currency: string;
  occurredAt: Date;
  description: string | null;
  merchantName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string;
  accountName: string | null;
}

export class BudgetsRepository {
  constructor(private readonly database: PrismaClient = prisma) {}
  transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.database.$transaction(operation);
  }
  find(
    workspaceId: string,
    id: string,
    client: PrismaClient | Prisma.TransactionClient = this.database,
  ) {
    return client.budget.findFirst({ where: { id, workspaceId }, select: budgetSelect });
  }
  async list(workspaceId: string, filters: ListBudgetsInput) {
    const where: Prisma.BudgetWhereInput = {
      workspaceId,
      ...(filters.status === "ARCHIVED"
        ? { deletedAt: { not: null }, isActive: false }
        : filters.status === "ALL" || filters.includeArchived === "true"
          ? {}
          : { deletedAt: null, isActive: true }),
      ...(filters.period ? { period: filters.period } : {}),
      ...(filters.currency ? { currency: filters.currency } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
      ...(filters.dateFrom ? { endsOn: { gte: new Date(`${filters.dateFrom}T00:00:00Z`) } } : {}),
      ...(filters.dateTo ? { startsOn: { lte: new Date(`${filters.dateTo}T00:00:00Z`) } } : {}),
      ...(filters.categoryId
        ? { budgetCategories: { some: { categoryId: filters.categoryId } } }
        : {}),
      ...(filters.accountId ? { budgetAccounts: { some: { accountId: filters.accountId } } } : {}),
    };
    return Promise.all([
      this.database.budget.findMany({
        where,
        select: budgetSelect,
        orderBy: [{ startsOn: "desc" }, { name: "asc" }, { id: "asc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.database.budget.count({ where }),
    ]);
  }
  async spending(workspaceId: string, budgetIds: string[]): Promise<SpendingRow[]> {
    if (!budgetIds.length) return [];
    return this.database.$queryRaw<SpendingRow[]>(Prisma.sql`
      SELECT b.id AS "budgetId", COALESCE(SUM(t.amount),0)::numeric AS spent
      FROM budgets b
      JOIN workspaces w ON w.id=b.workspace_id
      LEFT JOIN transactions t ON t.workspace_id=b.workspace_id
        AND t.type='EXPENSE'::transaction_type AND t.status='CONFIRMED'::transaction_status
        AND t.deleted_at IS NULL AND t.currency=b.currency
        AND t.occurred_at >= (b.starts_on::timestamp AT TIME ZONE w.timezone)
        AND t.occurred_at < LEAST(((b.ends_on + 1)::timestamp AT TIME ZONE w.timezone), CURRENT_TIMESTAMP)
        AND (NOT EXISTS (SELECT 1 FROM budget_categories bc0 WHERE bc0.budget_id=b.id)
          OR EXISTS (SELECT 1 FROM budget_categories bc WHERE bc.budget_id=b.id AND bc.category_id=t.category_id))
        AND (NOT EXISTS (SELECT 1 FROM budget_accounts ba0 WHERE ba0.budget_id=b.id)
          OR EXISTS (SELECT 1 FROM budget_accounts ba WHERE ba.budget_id=b.id AND ba.account_id=t.account_id))
      WHERE b.workspace_id::text=${workspaceId} AND b.id::text IN (${Prisma.join(budgetIds)})
      GROUP BY b.id`);
  }
  async movements(workspaceId: string, budgetId: string): Promise<BudgetMovementRow[]> {
    return this.database.$queryRaw<BudgetMovementRow[]>(Prisma.sql`
      SELECT
        t.id::text AS id,
        t.amount::numeric AS amount,
        t.currency AS currency,
        t.occurred_at AS "occurredAt",
        t.description AS description,
        t.merchant_name AS "merchantName",
        t.category_id::text AS "categoryId",
        c.name AS "categoryName",
        t.account_id::text AS "accountId",
        a.name AS "accountName"
      FROM budgets b
      JOIN workspaces w ON w.id=b.workspace_id
      JOIN transactions t ON t.workspace_id=b.workspace_id
        AND t.type='EXPENSE'::transaction_type
        AND t.status='CONFIRMED'::transaction_status
        AND t.deleted_at IS NULL
        AND t.currency=b.currency
        AND t.occurred_at >= (b.starts_on::timestamp AT TIME ZONE w.timezone)
        AND t.occurred_at < LEAST(((b.ends_on + 1)::timestamp AT TIME ZONE w.timezone), CURRENT_TIMESTAMP)
        AND (NOT EXISTS (SELECT 1 FROM budget_categories bc0 WHERE bc0.budget_id=b.id)
          OR EXISTS (SELECT 1 FROM budget_categories bc WHERE bc.budget_id=b.id AND bc.category_id=t.category_id))
        AND (NOT EXISTS (SELECT 1 FROM budget_accounts ba0 WHERE ba0.budget_id=b.id)
          OR EXISTS (SELECT 1 FROM budget_accounts ba WHERE ba.budget_id=b.id AND ba.account_id=t.account_id))
      LEFT JOIN categories c ON c.id=t.category_id
      LEFT JOIN financial_accounts a ON a.id=t.account_id
      WHERE b.workspace_id::text=${workspaceId} AND b.id::text=${budgetId}
      ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC`);
  }
  create(tx: Prisma.TransactionClient, workspaceId: string, input: CreateBudgetInput) {
    return tx.budget.create({
      data: {
        workspaceId,
        name: input.name,
        period: input.period,
        startsOn: new Date(`${input.startsOn}T00:00:00Z`),
        endsOn: new Date(`${input.endsOn}T00:00:00Z`),
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        alertThreshold: new Prisma.Decimal(input.alertThreshold),
        rolloverEnabled: input.rolloverEnabled,
        budgetCategories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) },
        budgetAccounts: { create: input.accountIds.map((accountId) => ({ accountId })) },
      },
      select: budgetSelect,
    });
  }
  async archive(workspaceId: string, id: string) {
    return this.database.budget.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { isActive: false, deletedAt: new Date() },
    });
  }
}
export const budgetsRepository = new BudgetsRepository();
