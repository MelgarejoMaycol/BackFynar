import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { transactionSelect } from "./transactions.mapper.js";
import type { ListTransactionsInput } from "./transactions.schemas.js";

export class TransactionsRepository {
  constructor(private readonly database: PrismaClient = prisma) {}
  transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return withTransactionRetry(() =>
      this.database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      }),
    );
  }
  list(workspaceId: string, filters: ListTransactionsInput) {
    const deleted =
      filters.status === "CANCELLED" ? { deletedAt: { not: null } } : { deletedAt: null };
    const where: Prisma.TransactionWhereInput = {
      workspaceId,
      ...deleted,
      AND: [
        ...(filters.accountId
          ? [
              {
                OR: [{ accountId: filters.accountId }, { destinationAccountId: filters.accountId }],
              },
            ]
          : []),
        ...(filters.search
          ? [
              {
                OR: [
                  { description: { contains: filters.search, mode: "insensitive" as const } },
                  { notes: { contains: filters.search, mode: "insensitive" as const } },
                  { merchantName: { contains: filters.search, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.destinationAccountId
        ? { destinationAccountId: filters.destinationAccountId }
        : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            occurredAt: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
      ...(filters.minAmount || filters.maxAmount
        ? {
            amount: {
              ...(filters.minAmount ? { gte: new Prisma.Decimal(filters.minAmount) } : {}),
              ...(filters.maxAmount ? { lte: new Prisma.Decimal(filters.maxAmount) } : {}),
            },
          }
        : {}),
    };
    let cursor: { occurredAt: Date; createdAt: Date; id: string } | undefined;
    if (filters.cursor) {
      try {
        const value = JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"));
        cursor = { occurredAt: new Date(value.occurredAt), createdAt: new Date(value.createdAt), id: value.id };
        if (!cursor.id || Number.isNaN(cursor.occurredAt.valueOf()) || Number.isNaN(cursor.createdAt.valueOf()))
          throw new Error("invalid cursor");
      } catch {
        cursor = undefined;
      }
    }
    const cursorWhere: Prisma.TransactionWhereInput = cursor
      ? { OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, createdAt: { lt: cursor.createdAt } },
          { occurredAt: cursor.occurredAt, createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] }
      : {};
    return Promise.all([
      this.database.transaction.findMany({
        where: { AND: [where, cursorWhere] },
        select: transactionSelect,
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        ...(filters.page && !filters.cursor ? { skip: (filters.page - 1) * filters.limit } : {}),
        take: filters.cursor || !filters.page ? filters.limit + 1 : filters.limit,
      }),
      this.database.transaction.count({ where }),
    ]);
  }
  find(
    workspaceId: string,
    id: string,
    client: Prisma.TransactionClient | PrismaClient = this.database,
  ) {
    return client.transaction.findFirst({ where: { id, workspaceId }, select: transactionSelect });
  }
  async lockAccounts(tx: Prisma.TransactionClient, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    if (unique.length)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM financial_accounts WHERE id::text IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`,
      );
  }
  async lockTransaction(tx: Prisma.TransactionClient, id: string, workspaceId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM transactions WHERE id::text=${id} AND workspace_id::text=${workspaceId} FOR UPDATE`,
    );
    return this.find(workspaceId, id, tx);
  }
}
export const transactionsRepository = new TransactionsRepository();
