import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import { accountSelect } from "./accounts.mapper.js";
import type { ListAccountsInput } from "./accounts.schemas.js";

export class AccountsRepository {
  constructor(private readonly database: PrismaClient = prisma) {}
  create(
    workspaceId: string,
    data: Omit<Prisma.FinancialAccountUncheckedCreateInput, "workspaceId">,
  ) {
    return this.database.financialAccount.create({
      data: { ...data, workspaceId },
      select: accountSelect,
    });
  }
  list(workspaceId: string, filters: ListAccountsInput) {
    return this.database.financialAccount.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        isActive: filters.archived === "true" ? false : filters.archived === "false" ? true : true,
        ...(filters.excludeCreditCards === "true"
          ? { type: { not: "CREDIT_CARD" as const } }
          : filters.type
            ? { type: filters.type }
            : {}),
        ...(filters.nature ? { nature: filters.nature } : {}),
        ...(filters.favorite ? { isFavorite: filters.favorite === "true" } : {}),
        ...(filters.currency ? { currency: filters.currency } : {}),
        ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
      },
      select: accountSelect,
      orderBy: [
        { isFavorite: "desc" },
        { isActive: "desc" },
        { name: "asc" },
        { createdAt: "asc" },
      ],
      take: 100,
    });
  }
  find(workspaceId: string, accountId: string) {
    return this.database.financialAccount.findFirst({
      where: { id: accountId, workspaceId, deletedAt: null },
      select: accountSelect,
    });
  }
  mutate(
    workspaceId: string,
    accountId: string,
    buildData: (
      current: Awaited<ReturnType<AccountsRepository["find"]>>,
    ) => Prisma.FinancialAccountUpdateManyMutationInput,
  ) {
    return withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const current = await tx.financialAccount.findFirst({
            where: { id: accountId, workspaceId, deletedAt: null },
            select: accountSelect,
          });
          if (!current) return null;
          const updated = await tx.financialAccount.updateMany({
            where: { id: accountId, workspaceId, deletedAt: null },
            data: buildData(current),
          });
          if (updated.count !== 1) return null;
          return tx.financialAccount.findFirst({
            where: { id: accountId, workspaceId, deletedAt: null },
            select: accountSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
  softDelete(workspaceId: string, accountId: string) {
    return withTransactionRetry(() =>
      this.database.$transaction(async (tx) => {
        const current = await tx.financialAccount.findFirst({
          where: { id: accountId, workspaceId },
          select: { id: true, deletedAt: true },
        });
        if (!current) return "missing" as const;
        if (current.deletedAt) return "deleted" as const;
        await tx.financialAccount.updateMany({
          where: { id: accountId, workspaceId, deletedAt: null },
          data: { deletedAt: new Date(), isActive: false },
        });
        return "deleted" as const;
      }),
    );
  }

  removeSafely(workspaceId: string, userId: string, accountId: string) {
    return withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const current = await tx.financialAccount.findFirst({
            where: { id: accountId, workspaceId, deletedAt: null },
            select: { id: true, name: true },
          });
          if (!current) return null;
          const [
            transactions,
            debts,
            obligations,
            goals,
            purchases,
            statements,
            advancesFrom,
            advancesTo,
            occurrencePayments,
            snapshots,
          ] = await Promise.all([
            tx.transaction.count({
              where: { workspaceId, OR: [{ accountId }, { destinationAccountId: accountId }] },
            }),
            tx.debt.count({ where: { workspaceId, liabilityAccountId: accountId } }),
            tx.recurringObligation.count({ where: { workspaceId, paymentAccountId: accountId } }),
            tx.savingsGoal.count({ where: { workspaceId, accountId } }),
            tx.cardPurchase.count({ where: { workspaceId, cardAccountId: accountId } }),
            tx.cardStatement.count({ where: { workspaceId, cardAccountId: accountId } }),
            tx.cardCashAdvance.count({ where: { workspaceId, cardAccountId: accountId } }),
            tx.cardCashAdvance.count({ where: { workspaceId, destinationAccountId: accountId } }),
            tx.obligationOccurrence.count({ where: { workspaceId, paymentAccountId: accountId } }),
            tx.accountBalanceSnapshot.count({ where: { accountId } }),
          ]);
          const dependencies = {
            transactions,
            debts,
            obligations,
            goals,
            purchases,
            statements,
            advancesFrom,
            advancesTo,
            occurrencePayments,
            snapshots,
          };
          const hasHistory = Object.values(dependencies).some((count) => count > 0);
          if (hasHistory) {
            await tx.financialAccount.updateMany({
              where: { id: accountId, workspaceId, deletedAt: null },
              data: { deletedAt: new Date(), isActive: false },
            });
            await recordDeletionAudit(tx, {
              workspaceId,
              userId,
              entityType: "FINANCIAL_ACCOUNT",
              entityId: accountId,
              mode: "LOGICAL",
              name: current.name,
              dependencies,
            });
            return { mode: "LOGICAL" as const, dependencies };
          }
          await tx.budgetAccount.deleteMany({ where: { accountId } });
          await tx.accountBalanceSnapshot.deleteMany({ where: { accountId } });
          await recordDeletionAudit(tx, {
            workspaceId,
            userId,
            entityType: "FINANCIAL_ACCOUNT",
            entityId: accountId,
            mode: "PHYSICAL",
            name: current.name,
            dependencies,
          });
          await tx.financialAccount.delete({ where: { id: accountId } });
          return { mode: "PHYSICAL" as const, dependencies };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}

export const accountsRepository = new AccountsRepository();
