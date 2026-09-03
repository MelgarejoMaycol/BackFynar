import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors/app-error.js";
import { assertSufficientTransferFunds } from "../transactions/transactions.service.js";

export class PersonalBalanceSourceAccountService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async link(
    workspaceId: string,
    userId: string,
    personalBalanceId: string,
    sourceAccountId: string,
  ) {
    await this.db.$transaction(async (tx) => {
      const balances = await tx.$queryRaw<Array<{
        id: string;
        direction: "PAYABLE" | "RECEIVABLE";
        original_amount: Prisma.Decimal;
        currency: string;
        counterparty_name: string;
        occurred_on: Date;
      }>>(Prisma.sql`
        SELECT id, direction, original_amount, currency, counterparty_name, occurred_on
        FROM personal_balances
        WHERE workspace_id=${workspaceId}::uuid AND id=${personalBalanceId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      const balance = balances[0];
      if (!balance) throw new NotFoundError("Saldo entre personas no encontrado");
      if (balance.direction !== "RECEIVABLE") {
        throw new ValidationError("La cuenta de origen solo aplica cuando prestaste dinero y te deben");
      }

      const openingEntries = await tx.$queryRaw<Array<{
        id: string;
        account_id: string | null;
        transaction_id: string | null;
      }>>(Prisma.sql`
        SELECT id, account_id, transaction_id
        FROM personal_balance_entries
        WHERE workspace_id=${workspaceId}::uuid
          AND balance_id=${personalBalanceId}::uuid
          AND entry_type='OPENING'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
      `);
      const opening = openingEntries[0];
      if (!opening) throw new ConflictError("Registro inicial no encontrado");
      if (opening.account_id) {
        if (opening.account_id === sourceAccountId) return;
        throw new ConflictError(
          "Cuenta de origen ya registrada",
          "Para evitar descontar el préstamo dos veces, la cuenta de origen no puede cambiarse después de aplicarla.",
        );
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM financial_accounts
        WHERE workspace_id=${workspaceId}::uuid AND id=${sourceAccountId}::uuid
        FOR UPDATE
      `);
      const account = await tx.financialAccount.findFirst({
        where: {
          id: sourceAccountId,
          workspaceId,
          nature: "ASSET",
          isActive: true,
          deletedAt: null,
        },
      });
      if (!account) throw new NotFoundError("Cuenta de origen activa no encontrada");
      if (account.currency !== balance.currency) {
        throw new ConflictError("Monedas incompatibles", "La cuenta y el préstamo deben usar la misma moneda");
      }
      assertSufficientTransferFunds(balance.original_amount, account.currentBalance);

      await tx.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { decrement: balance.original_amount } },
      });
      const transaction = await tx.transaction.create({
        data: {
          workspaceId,
          createdBy: userId,
          type: "ADJUSTMENT",
          status: "CONFIRMED",
          amount: balance.original_amount,
          currency: balance.currency,
          accountId: account.id,
          occurredAt: new Date(`${balance.occurred_on.toISOString().slice(0, 10)}T12:00:00.000Z`),
          description: `Préstamo informal a ${balance.counterparty_name}`,
          metadata: {
            source: "PERSONAL_BALANCE",
            personalBalanceId,
            role: "LOAN_DISBURSEMENT",
            balanceEffect: "DEBIT_ASSET",
          },
        },
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE personal_balance_entries
        SET account_id=${account.id}::uuid,
            transaction_id=${transaction.id}::uuid,
            updated_at=now()
        WHERE workspace_id=${workspaceId}::uuid AND id=${opening.id}::uuid
      `);
      await tx.auditLog.create({
        data: {
          workspaceId,
          userId,
          entityType: "PERSONAL_BALANCE",
          entityId: personalBalanceId,
          action: "LINK_SOURCE_ACCOUNT",
          newData: { sourceAccountId: account.id, amount: balance.original_amount.toFixed(2) },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export const personalBalanceSourceAccountService = new PersonalBalanceSourceAccountService();
