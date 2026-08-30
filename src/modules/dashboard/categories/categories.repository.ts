import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import { categorySelect } from "./categories.mapper.js";
import type { ListCategoriesInput } from "./categories.schemas.js";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
const visibleWhere = (workspaceId: string): Prisma.CategoryWhereInput => ({
  OR: [
    { workspaceId: null, isSystem: true },
    { workspaceId, isSystem: false },
  ],
});

export class CategoriesRepository {
  constructor(private readonly database: PrismaClient = prisma) {}

  transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withTransactionRetry(() =>
      this.database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  }

  list(workspaceId: string, filters: ListCategoriesInput) {
    const archived =
      filters.status === "ARCHIVED"
        ? { isActive: false, deletedAt: { not: null } }
        : filters.status === "ACTIVE" || filters.includeArchived !== "true"
          ? { isActive: true, deletedAt: null }
          : {};
    return this.database.category.findMany({
      where: {
        ...visibleWhere(workspaceId),
        ...archived,
        ...(filters.scope === "SYSTEM"
          ? { workspaceId: null, isSystem: true }
          : filters.scope === "CUSTOM"
            ? { workspaceId, isSystem: false }
            : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.parentId ? { parentId: filters.parentId } : {}),
        ...(filters.search
          ? { name: { contains: filters.search, mode: Prisma.QueryMode.insensitive } }
          : {}),
      },
      select: categorySelect,
      orderBy: [{ isSystem: "desc" }, { type: "asc" }, { parentId: "asc" }, { name: "asc" }],
      take: 500,
    });
  }

  findVisible(workspaceId: string, categoryId: string, client: DatabaseClient = this.database) {
    return client.category.findFirst({
      where: { id: categoryId, ...visibleWhere(workspaceId) },
      select: { ...categorySelect, workspaceId: true, deletedAt: true },
    });
  }

  create(
    workspaceId: string,
    data: Omit<Prisma.CategoryUncheckedCreateInput, "workspaceId" | "isSystem">,
    client: DatabaseClient,
  ) {
    return client.category.create({
      data: { ...data, workspaceId, isSystem: false },
      select: categorySelect,
    });
  }

  update(
    workspaceId: string,
    categoryId: string,
    data: Prisma.CategoryUpdateManyMutationInput,
    client: DatabaseClient,
  ) {
    return client.category.updateMany({
      where: { id: categoryId, workspaceId, isSystem: false },
      data,
    });
  }

  countActiveChildren(workspaceId: string, categoryId: string, client: DatabaseClient) {
    return client.category.count({
      where: {
        parentId: categoryId,
        isActive: true,
        deletedAt: null,
        OR: [
          { workspaceId: null, isSystem: true },
          { workspaceId, isSystem: false },
        ],
      },
    });
  }

  archive(workspaceId: string, userId: string, categoryId: string) {
    return this.transaction(async (tx) => {
      const current = await this.findVisible(workspaceId, categoryId, tx);
      if (!current) return null;
      const [transactions, splits, budgets, merchantRules, obligations, children] =
        await Promise.all([
          tx.transaction.count({ where: { workspaceId, categoryId } }),
          tx.transactionSplit.count({ where: { categoryId, transactions: { workspaceId } } }),
          tx.budgetCategory.count({ where: { categoryId, budgets: { workspaceId } } }),
          tx.merchantCategoryRule.count({ where: { workspaceId, categoryId } }),
          tx.recurringObligation.count({ where: { workspaceId, categoryId } }),
          tx.category.count({ where: { parentId: categoryId } }),
        ]);
      const dependencies = { transactions, splits, budgets, merchantRules, obligations, children };
      const archived = await tx.category.updateMany({
        where: { id: categoryId, workspaceId, isSystem: false, deletedAt: null },
        data: { isActive: false, deletedAt: new Date() },
      });
      if (archived.count !== 1) return null;
      await recordDeletionAudit(tx, {
        workspaceId,
        userId,
        entityType: "CATEGORY",
        entityId: categoryId,
        mode: "LOGICAL",
        name: current.name,
        dependencies,
      });
      return { current, mode: "LOGICAL" as const, dependencies };
    });
  }
}

export const categoriesRepository = new CategoriesRepository();
