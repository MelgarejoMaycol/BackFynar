import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import type { z } from "zod";
import type {
  cardPaymentSchema,
  cardPaymentExpectationSchema,
  cashAdvanceSchema,
  createCardSchema,
  purchaseSchema,
  statementSchema,
  updateCardSchema,
} from "./cards.schemas.js";
import {
  cardStatementEventWhere,
  syncFinancialEvent,
} from "../liabilities/financial-event-sync.service.js";
import { synchronizeCardPurchase } from "./domain/card-purchase.js";
import { cardCycleDates } from "./domain/card-cycle.js";
import { calculateCardStatementBalance } from "./domain/card-statement.js";
type PurchaseInput = z.infer<typeof purchaseSchema>;
type StatementInput = z.infer<typeof statementSchema>;
type CardPaymentInput = z.infer<typeof cardPaymentSchema>;
type CardPaymentExpectationInput = z.infer<typeof cardPaymentExpectationSchema>;
type CreateCardInput = z.infer<typeof createCardSchema>;
type CashAdvanceInput = z.infer<typeof cashAdvanceSchema>;
type UpdateCardInput = z.infer<typeof updateCardSchema>;
const D = (x: string) => new Prisma.Decimal(x),
  day = (x: string) => new Date(`${x}T00:00:00Z`),
  pub = <T>(x: T): T =>
    JSON.parse(JSON.stringify(x, (_k, v) => (v instanceof Prisma.Decimal ? v.toFixed(2) : v)));
const publicCardAccount = <T extends {
  openingBalance: Prisma.Decimal;
  currentBalance: Prisma.Decimal;
  creditLimit: Prisma.Decimal | null;
  referencePeriodicRate: Prisma.Decimal | null;
}>(account: T) => ({
  ...pub(account),
  openingBalance: account.openingBalance.toFixed(2),
  currentBalance: account.currentBalance.toFixed(2),
  creditLimit: account.creditLimit?.toFixed(2) ?? null,
  referencePeriodicRate: account.referencePeriodicRate?.toString() ?? null,
});
export class CardsService {
  constructor(private db: PrismaClient = prisma) {}
  private tx<T>(f: (t: Prisma.TransactionClient) => Promise<T>) {
    return withTransactionRetry(() => this.db.$transaction(f, { isolationLevel: "Serializable" }));
  }
  async create(w: string, i: CreateCardInput) {
    const limit = D(i.creditLimit);
    const used = i.usedCredit
      ? D(i.usedCredit)
      : i.availableCredit
        ? limit.minus(i.availableCredit)
        : new Prisma.Decimal(0);
    if (used.lt(0) || used.gt(limit))
      throw new ConflictError("Cupo disponible o utilizado inválido");
    const workspace = await this.db.workspace.findUnique({
      where: { id: w },
      select: { timezone: true },
    });
    const paidThrough =
      i.currentCyclePaid && i.paymentDueDay
        ? cardCycleDates(
            new Date(),
            i.billingDay ?? null,
            i.paymentDueDay,
            workspace?.timezone ?? "UTC",
          ).nextPaymentDate
        : null;
    return this.db.financialAccount
      .create({
        data: {
          workspaceId: w,
          name: i.name.trim().replace(/\s+/g, " "),
          institutionName: i.institutionName ?? null,
          type: "CREDIT_CARD",
          nature: "LIABILITY",
          currency: i.currency,
          openingBalance: used,
          currentBalance: used,
          creditLimit: limit,
          billingDay: i.billingDay ?? null,
          paymentDueDay: i.paymentDueDay ?? null,
          cardCyclePaidThrough: paidThrough,
          includeInNetWorth: true,
          referencePeriodicRate: i.referencePeriodicRate ? D(i.referencePeriodicRate) : null,
          referenceRateSource: i.referencePeriodicRate
            ? (i.referenceRateSource ?? "INFORMED")
            : null,
        },
      })
      .then(publicCardAccount);
  }
  async update(w: string, cardId: string, i: UpdateCardInput) {
    return this.tx(async (t) => {
      const card = await t.financialAccount.findFirst({
        where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
      });
      if (!card) throw new NotFoundError("Tarjeta no encontrada");
      const limit = i.creditLimit ? D(i.creditLimit) : card.creditLimit;
      if (limit && card.currentBalance.gt(limit))
        throw new ConflictError("El cupo no puede ser menor que la deuda actual");
      const updated = await t.financialAccount.update({
        where: { id: cardId },
        data: {
          ...(i.name !== undefined ? { name: i.name.trim().replace(/\s+/g, " ") } : {}),
          ...(i.institutionName !== undefined ? { institutionName: i.institutionName } : {}),
          ...(i.creditLimit !== undefined ? { creditLimit: D(i.creditLimit) } : {}),
          ...(i.billingDay !== undefined ? { billingDay: i.billingDay } : {}),
          ...(i.paymentDueDay !== undefined ? { paymentDueDay: i.paymentDueDay } : {}),
          ...(i.referencePeriodicRate !== undefined
            ? {
                referencePeriodicRate: i.referencePeriodicRate
                  ? D(i.referencePeriodicRate)
                  : null,
                referenceRateSource: i.referencePeriodicRate
                  ? (i.referenceRateSource ?? "INFORMED")
                  : null,
              }
            : i.referenceRateSource !== undefined
              ? { referenceRateSource: i.referenceRateSource }
              : {}),
        },
      });
      return publicCardAccount(updated);
    });
  }
  async cashAdvance(w: string, u: string, cardId: string, i: CashAdvanceInput) {
    return this.tx(async (t) => {
      const prior = await t.transaction.findFirst({
        where: { workspaceId: w, externalReference: i.idempotencyKey },
      });
      if (prior) return { transactionId: prior.id, idempotent: true };
      const [card, destination] = await Promise.all([
        t.financialAccount.findFirst({
          where: {
            id: cardId,
            workspaceId: w,
            type: "CREDIT_CARD",
            nature: "LIABILITY",
            isActive: true,
            deletedAt: null,
          },
        }),
        t.financialAccount.findFirst({
          where: {
            id: i.destinationAccountId,
            workspaceId: w,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
            issuedLoansReceivable: { none: {} },
          },
        }),
      ]);
      if (!card || !destination) throw new NotFoundError("Tarjeta o cuenta destino no encontrada");
      if (card.currency !== destination.currency) throw new ConflictError("Moneda incompatible");
      const amount = D(i.amount),
        fee = D(i.feeAmount),
        debtIncrease = amount.plus(fee);
      if (card.creditLimit && card.currentBalance.plus(debtIncrease).gt(card.creditLimit))
        throw new ConflictError("Cupo insuficiente");
      const tr = await t.transaction.create({
        data: {
          workspaceId: w,
          createdBy: u,
          type: "TRANSFER",
          status: "CONFIRMED",
          amount,
          currency: card.currency,
          accountId: card.id,
          destinationAccountId: destination.id,
          occurredAt: new Date(i.occurredAt),
          description: `Avance ${card.name}`,
          notes: i.notes ?? null,
          externalReference: i.idempotencyKey,
          metadata: { cardCashAdvance: true, feeAmount: fee.toFixed(2) },
        },
      });
      await t.financialAccount.update({
        where: { id: card.id },
        data: { currentBalance: { increment: debtIncrease } },
      });
      await t.financialAccount.update({
        where: { id: destination.id },
        data: { currentBalance: { increment: amount } },
      });
      const advance = await t.cardCashAdvance.create({
        data: {
          workspaceId: w,
          cardAccountId: card.id,
          destinationAccountId: destination.id,
          transactionId: tr.id,
          amount,
          feeAmount: fee,
          periodicRate: i.periodicRate ? D(i.periodicRate) : card.referencePeriodicRate,
          rateSource: i.periodicRate ? "INFORMED" : (card.referenceRateSource ?? "ESTIMATED"),
          installmentCount: i.installmentCount ?? null,
          notes: i.notes ?? null,
          occurredAt: new Date(i.occurredAt),
        },
      });
      return { id: advance.id, transactionId: tr.id, idempotent: false };
    });
  }
  async list(w: string) {
    const [cards, workspace, statements, expectations] = await Promise.all([
      this.db.financialAccount.findMany({
        where: { workspaceId: w, type: "CREDIT_CARD", nature: "LIABILITY", deletedAt: null },
      }),
      this.db.workspace.findUnique({ where: { id: w }, select: { timezone: true } }),
      this.db.cardStatement.findMany({
        where: { workspaceId: w, status: { in: ["OPEN", "PARTIAL"] } },
        orderBy: { dueDate: "asc" },
      }),
      this.db.cardPaymentExpectation.findMany({
        where: {
          workspaceId: w,
          supersededAt: null,
          status: { not: "CANCELLED" },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      }),
    ]);
    const now = new Date();
    return cards.map((c) => {
      const limit = c.creditLimit ?? new Prisma.Decimal(0),
        used = Prisma.Decimal.max(0, c.currentBalance);
      const cycleReference = c.cardCyclePaidThrough
        ? new Date(c.cardCyclePaidThrough.getTime() + 36 * 60 * 60 * 1000)
        : now;
      const cycle = cardCycleDates(
        cycleReference,
        c.billingDay,
        c.paymentDueDay,
        workspace?.timezone ?? "UTC",
      );
      const statement = statements.find((item) => item.cardAccountId === c.id);
      const expectation = expectations.find((item) => item.cardAccountId === c.id);
      return {
        ...pub(c),
        creditLimit: c.creditLimit?.toFixed(2) ?? null,
        openingBalance: c.openingBalance.toFixed(2),
        currentBalance: c.currentBalance.toFixed(2),
        usedCredit: used.toFixed(2),
        availableCredit: Prisma.Decimal.max(0, limit.minus(used)).toFixed(2),
        utilization: limit.gt(0) ? used.div(limit).mul(100).toDecimalPlaces(2).toString() : "0",
        nextBillingDate: cycle.nextBillingDate?.toISOString().slice(0, 10) ?? null,
        nextPaymentDate: used.lte(0)
          ? null
          : ((expectation && expectation.status !== "PAID"
              ? expectation.dueDate.toISOString().slice(0, 10)
              : null) ??
            statement?.dueDate.toISOString().slice(0, 10) ??
            cycle.nextPaymentDate?.toISOString().slice(0, 10) ??
            null),
        nextPayment:
          used.lte(0)
            ? null
            : expectation?.status === "PAID"
              ? null
              : expectation
              ? {
                  amount: expectation.amount.minus(expectation.paidAmount).toFixed(2),
                  originalAmount: expectation.amount.toFixed(2),
                  paidAmount: expectation.paidAmount.toFixed(2),
                  minimumPayment: expectation.minimumPayment
                    ? Prisma.Decimal.max(
                        0,
                        expectation.minimumPayment.minus(expectation.paidAmount),
                      ).toFixed(2)
                    : null,
                  source: "INFORMED" as const,
                  statementId: null,
                  expectationId: expectation.id,
                  reportedTotalBalance: expectation.reportedTotalBalance?.toFixed(2) ?? null,
                }
              : statement
              ? {
                  amount: (statement.reportedBalance ?? statement.calculatedBalance)
                    .minus(statement.paidAmount)
                    .toFixed(2),
                  originalAmount: (statement.reportedBalance ?? statement.calculatedBalance).toFixed(2),
                  paidAmount: statement.paidAmount.toFixed(2),
                  minimumPayment: statement.minimumPayment.gt(0)
                    ? Prisma.Decimal.max(
                        0,
                        statement.minimumPayment.minus(statement.paidAmount),
                      ).toFixed(2)
                    : null,
                  source: statement.reportedBalance ? "INFORMED" : "ESTIMATED",
                  statementId: statement.id,
                  expectationId: null,
                  reportedTotalBalance: statement.reportedBalance?.toFixed(2) ?? null,
                }
              : {
                  amount: used.toFixed(2),
                  originalAmount: used.toFixed(2),
                  paidAmount: "0.00",
                  minimumPayment: null,
                  source: "ESTIMATED",
                  statementId: null,
                  expectationId: null,
                  reportedTotalBalance: null,
                },
      };
    });
  }

  async activity(w: string, cardId: string) {
    const card = await this.db.financialAccount.findFirst({
      where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
      select: { id: true },
    });
    if (!card) throw new NotFoundError("Tarjeta no encontrada");
    const rows = await this.db.transaction.findMany({
      where: {
        workspaceId: w,
        status: "CONFIRMED",
        deletedAt: null,
        OR: [{ accountId: cardId }, { destinationAccountId: cardId }],
      },
      include: {
        cardPurchase: { select: { id: true } },
        cardCashAdvance: { select: { id: true, feeAmount: true } },
        financialAccountsTransactionsAccountIdTofinancialAccounts: { select: { name: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return pub(
      rows.map((row) => ({
        id: row.id,
        type: row.cardCashAdvance
          ? "CASH_ADVANCE"
          : row.destinationAccountId === cardId
            ? "PAYMENT"
            : row.cardPurchase || row.type === "EXPENSE"
              ? "PURCHASE"
              : "OTHER",
        description:
          row.destinationAccountId === cardId
            ? `Pago desde ${row.financialAccountsTransactionsAccountIdTofinancialAccounts?.name ?? "cuenta"}`
            : (row.description ?? "Actividad de tarjeta"),
        amount: row.amount,
        feeAmount: row.cardCashAdvance?.feeAmount ?? null,
        occurredAt: row.occurredAt,
      })),
    );
  }
  async remove(w: string, u: string, cardId: string) {
    return this.tx(async (t) => {
      const card = await t.financialAccount.findFirst({
        where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
        select: { id: true, name: true },
      });
      if (!card) throw new NotFoundError("Tarjeta no encontrada");
      const [transactions, purchases, statements, cashAdvances, debts, obligations] =
        await Promise.all([
          t.transaction.count({
            where: {
              workspaceId: w,
              OR: [{ accountId: cardId }, { destinationAccountId: cardId }],
            },
          }),
          t.cardPurchase.count({ where: { workspaceId: w, cardAccountId: cardId } }),
          t.cardStatement.count({ where: { workspaceId: w, cardAccountId: cardId } }),
          t.cardCashAdvance.count({
            where: {
              workspaceId: w,
              OR: [{ cardAccountId: cardId }, { destinationAccountId: cardId }],
            },
          }),
          t.debt.count({ where: { workspaceId: w, liabilityAccountId: cardId } }),
          t.recurringObligation.count({ where: { workspaceId: w, paymentAccountId: cardId } }),
        ]);
      const dependencies = {
        transactions,
        purchases,
        statements,
        cashAdvances,
        debts,
        obligations,
      };
      if (Object.values(dependencies).some((count) => count > 0)) {
        await t.financialAccount.updateMany({
          where: { id: cardId, workspaceId: w, deletedAt: null },
          data: { deletedAt: new Date(), isActive: false },
        });
        await recordDeletionAudit(t, {
          workspaceId: w,
          userId: u,
          entityType: "CREDIT_CARD",
          entityId: card.id,
          mode: "LOGICAL",
          name: card.name,
          dependencies,
        });
        return { mode: "LOGICAL" as const, dependencies };
      }
      await t.budgetAccount.deleteMany({ where: { accountId: cardId } });
      await t.accountBalanceSnapshot.deleteMany({ where: { accountId: cardId } });
      await recordDeletionAudit(t, {
        workspaceId: w,
        userId: u,
        entityType: "CREDIT_CARD",
        entityId: card.id,
        mode: "PHYSICAL",
        name: card.name,
        dependencies,
      });
      await t.financialAccount.delete({ where: { id: cardId } });
      return { mode: "PHYSICAL" as const, dependencies };
    });
  }
  async purchase(w: string, u: string, cardId: string, i: PurchaseInput) {
    return this.tx(async (t) => {
      const prior = await t.transaction.findFirst({
        where: { workspaceId: w, externalReference: i.idempotencyKey },
      });
      if (prior) return { transactionId: prior.id, idempotent: true };
      const card = await t.financialAccount.findFirst({
        where: {
          id: cardId,
          workspaceId: w,
          type: "CREDIT_CARD",
          nature: "LIABILITY",
          isActive: true,
          deletedAt: null,
        },
      });
      const category = await t.category.findFirst({
        where: {
          id: i.categoryId,
          type: "EXPENSE",
          OR: [{ workspaceId: w }, { workspaceId: null, isSystem: true }],
        },
      });
      if (!card || !category) throw new NotFoundError("Tarjeta o categoría no encontrada");
      const amount = D(i.amount);
      if (card.creditLimit && card.currentBalance.plus(amount).gt(card.creditLimit))
        throw new ConflictError("Cupo insuficiente");
      const tr = await t.transaction.create({
        data: {
          workspaceId: w,
          createdBy: u,
          type: "EXPENSE",
          status: "CONFIRMED",
          amount,
          currency: card.currency,
          accountId: card.id,
          categoryId: category.id,
          occurredAt: new Date(i.occurredAt),
          description: i.description,
          externalReference: i.idempotencyKey,
          metadata: { cardPurchase: true, installments: i.installmentCount },
        },
      });
      await t.financialAccount.update({
        where: { id: card.id },
        data: { currentBalance: { increment: amount } },
      });
      const purchase = await synchronizeCardPurchase(t, {
        workspaceId: w,
        cardAccountId: card.id,
        transactionId: tr.id,
        amount,
        occurredAt: new Date(i.occurredAt),
        installmentCount: i.installmentCount,
        periodicRate: i.periodicRate ? D(i.periodicRate) : (card.referencePeriodicRate ?? D("0")),
        rateSource: i.periodicRate ? "INFORMED" : (card.referenceRateSource === "INFORMED" ? "INFORMED" : "ESTIMATED"),
        firstDueDate: day(i.firstDueDate),
      });
      return { transactionId: tr.id, purchaseId: purchase.id, idempotent: false };
    });
  }
  async purchases(w: string, cardId: string) {
    const card = await this.db.financialAccount.findFirst({
      where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
      select: { id: true },
    });
    if (!card) throw new NotFoundError("Tarjeta no encontrada");
    const [tracked, legacyTransactions] = await Promise.all([
      this.db.cardPurchase.findMany({
        where: { workspaceId: w, cardAccountId: cardId },
        include: {
          transaction: { select: { description: true, amount: true, occurredAt: true } },
          installments: { orderBy: { installmentNumber: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.db.transaction.findMany({
        where: {
          workspaceId: w,
          accountId: cardId,
          type: "EXPENSE",
          status: "CONFIRMED",
          deletedAt: null,
          cardPurchase: null,
        },
        select: { id: true, description: true, amount: true, occurredAt: true, createdAt: true },
        orderBy: { occurredAt: "desc" },
      }),
    ]);
    return pub(
      [
        ...tracked.map((purchase) => ({
          ...purchase,
          trackingStatus: "ESTIMATED" as const,
          installments: purchase.installments.map((installment) => ({
            ...installment,
            trackingStatus: "ESTIMATED" as const,
          })),
        })),
        ...legacyTransactions.map((transaction) => ({
          id: `legacy-${transaction.id}`,
          workspaceId: w,
          cardAccountId: cardId,
          transactionId: transaction.id,
          installmentCount: 1,
          periodicRate: new Prisma.Decimal(0),
          outstandingBalance: transaction.amount,
          createdAt: transaction.createdAt,
          transaction: {
            description: transaction.description ?? "Compra con tarjeta",
            amount: transaction.amount,
            occurredAt: transaction.occurredAt,
          },
          installments: [],
          trackingStatus: "ESTIMATED" as const,
        })),
      ].sort((a, b) => b.transaction.occurredAt.getTime() - a.transaction.occurredAt.getTime()),
    );
  }
  async statement(w: string, cardId: string, i: StatementInput) {
    return this.tx(async (t) => {
      const card = await t.financialAccount.findFirst({
        where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
      });
      if (!card) throw new NotFoundError("Tarjeta no encontrada");
      const period = {
        gte: day(i.periodStart),
        lt: new Date(day(i.periodEnd).getTime() + 86_400_000),
      };
      const [purchases, payments] = await Promise.all([
        t.transaction.aggregate({
          _sum: { amount: true },
          where: {
            workspaceId: w,
            accountId: cardId,
            type: "EXPENSE",
            status: "CONFIRMED",
            deletedAt: null,
            occurredAt: period,
          },
        }),
        t.transaction.aggregate({
          _sum: { amount: true },
          where: {
            workspaceId: w,
            destinationAccountId: cardId,
            type: "TRANSFER",
            status: "CONFIRMED",
            deletedAt: null,
            occurredAt: period,
          },
        }),
      ]);
      const p = purchases._sum.amount ?? new Prisma.Decimal(0),
        paid = payments._sum.amount ?? new Prisma.Decimal(0),
        calc = calculateCardStatementBalance({
          previousBalance: D(i.previousBalance),
          purchases: p,
          payments: paid,
          interest: D(i.interestAmount),
          fees: D(i.feeAmount),
        });
      const statementData = {
          workspaceId: w,
          cardAccountId: cardId,
          periodStart: day(i.periodStart),
          periodEnd: day(i.periodEnd),
          dueDate: day(i.dueDate),
          previousBalance: D(i.previousBalance),
          purchasesAmount: p,
          paymentsAmount: paid,
          interestAmount: D(i.interestAmount),
          feeAmount: D(i.feeAmount),
          calculatedBalance: calc,
          reportedBalance: i.reportedBalance ? D(i.reportedBalance) : null,
          minimumPayment: D(i.minimumPayment),
        };
      const statement = await t.cardStatement.upsert({
        where: {
          workspaceId_cardAccountId_periodStart_periodEnd: {
            workspaceId: w,
            cardAccountId: cardId,
            periodStart: day(i.periodStart),
            periodEnd: day(i.periodEnd),
          },
        },
        create: statementData,
        update: {
          dueDate: statementData.dueDate,
          previousBalance: statementData.previousBalance,
          purchasesAmount: statementData.purchasesAmount,
          paymentsAmount: statementData.paymentsAmount,
          interestAmount: statementData.interestAmount,
          feeAmount: statementData.feeAmount,
          calculatedBalance: statementData.calculatedBalance,
          reportedBalance: statementData.reportedBalance,
          minimumPayment: statementData.minimumPayment,
        },
      });
      await t.financialEvent.upsert({
        where: {
          workspaceId_relatedCardStatementId: {
            workspaceId: w,
            relatedCardStatementId: statement.id,
          },
        },
        create: {
          workspaceId: w,
          type: "CARD_PAYMENT",
          title: `Pago tarjeta ${card.name}`,
          amount: i.reportedBalance ? D(i.reportedBalance) : calc,
          currency: card.currency,
          startsAt: day(i.dueDate),
          relatedCardStatementId: statement.id,
        },
        update: {
          title: `Pago tarjeta ${card.name}`,
          amount: i.reportedBalance ? D(i.reportedBalance) : calc,
          currency: card.currency,
          startsAt: day(i.dueDate),
          isCompleted: false,
        },
      });
      return pub(statement);
    });
  }
  async setNextPayment(
    w: string,
    u: string,
    cardId: string,
    i: CardPaymentExpectationInput,
  ) {
    return this.tx(async (t) => {
      const card = await t.financialAccount.findFirst({
        where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
      });
      if (!card) throw new NotFoundError("Tarjeta no encontrada");
      const amount = D(i.amount);
      const existing = await t.cardPaymentExpectation.findFirst({
        where: {
          workspaceId: w,
          cardAccountId: cardId,
          supersededAt: null,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing?.paidAmount.gt(0) && existing.dueDate.getTime() !== day(i.dueDate).getTime()) {
        throw new ConflictError("No puedes cambiar la fecha de un vencimiento parcialmente pagado");
      }
      if (existing && amount.lt(existing.paidAmount)) {
        throw new ConflictError("El valor corregido no puede ser menor que lo ya pagado");
      }
      const paidAmount = existing?.paidAmount ?? new Prisma.Decimal(0);
      if (amount.gt(card.currentBalance.plus(paidAmount))) {
        throw new ConflictError("El próximo pago no puede superar la deuda actual de la tarjeta");
      }
      const statement = await t.cardStatement.findFirst({
        where: {
          workspaceId: w,
          cardAccountId: cardId,
          dueDate: day(i.dueDate),
          status: { in: ["OPEN", "PARTIAL"] },
        },
      });
      if (statement) {
        if (amount.lt(statement.paidAmount)) {
          throw new ConflictError("El valor corregido no puede ser menor que lo ya pagado");
        }
        const updated = await t.cardStatement.update({
          where: { id: statement.id },
          data: {
            reportedBalance: amount,
            minimumPayment: i.minimumPayment ? D(i.minimumPayment) : statement.minimumPayment,
            status: amount.eq(statement.paidAmount) ? "PAID" : statement.paidAmount.gt(0) ? "PARTIAL" : "OPEN",
          },
        });
        await syncFinancialEvent(t, cardStatementEventWhere(w, statement.id), {
          remainingAmount: Prisma.Decimal.max(0, amount.minus(statement.paidAmount)),
          isCompleted: amount.eq(statement.paidAmount),
        });
        return pub(updated);
      }
      await t.cardPaymentExpectation.updateMany({
        where: {
          workspaceId: w,
          cardAccountId: cardId,
          supersededAt: null,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        data: { supersededAt: new Date() },
      });
      if (existing) {
        await t.financialEvent.updateMany({
          where: { workspaceId: w, relatedCardPaymentExpectationId: existing.id },
          data: { isCompleted: true, updatedAt: new Date() },
        });
      }
      const expectation = await t.cardPaymentExpectation.create({
          data: {
            workspaceId: w,
            cardAccountId: cardId,
            amount,
            dueDate: day(i.dueDate),
            minimumPayment: i.minimumPayment ? D(i.minimumPayment) : null,
            paidAmount,
            status: paidAmount.gt(0) ? "PARTIAL" : "PENDING",
            createdBy: u,
          },
        });
      await t.financialEvent.create({
        data: {
          workspaceId: w,
          type: "CARD_PAYMENT",
          title: `Pago tarjeta ${card.name}`,
          amount: amount.minus(paidAmount),
          currency: card.currency,
          startsAt: day(i.dueDate),
          relatedCardPaymentExpectationId: expectation.id,
          isCompleted: amount.eq(paidAmount),
        },
      });
      return pub(expectation);
    });
  }
  statements(w: string, cardId: string) {
    return this.db.cardStatement
      .findMany({
        where: { workspaceId: w, cardAccountId: cardId },
        orderBy: { periodEnd: "desc" },
      })
      .then(pub);
  }
  async pay(w: string, u: string, cardId: string, statementId: string, i: CardPaymentInput) {
    return this.payOperation(w, u, cardId, i, statementId);
  }
  async payBalance(w: string, u: string, cardId: string, i: CardPaymentInput) {
    return this.payOperation(w, u, cardId, i);
  }
  private async payOperation(
    w: string,
    u: string,
    cardId: string,
    i: CardPaymentInput,
    statementId?: string,
  ) {
    return this.tx(async (t) => {
      const prior = await t.transaction.findFirst({
        where: { workspaceId: w, externalReference: i.idempotencyKey },
      });
      if (prior) {
        const allocation = (prior.metadata as Prisma.JsonObject | null)?.cardPaymentAllocation;
        if (allocation && typeof allocation === "object" && !Array.isArray(allocation)) {
          const next = await t.cardPaymentExpectation.findFirst({
            where: {
              workspaceId: w,
              cardAccountId: cardId,
              supersededAt: null,
              status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
            },
            orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          });
          return {
            ...(allocation as Record<string, unknown>),
            transactionId: prior.id,
            idempotent: true,
            nextPayment: next
              ? {
                  amount: next.amount.minus(next.paidAmount).toFixed(2),
                  dueDate: next.dueDate.toISOString().slice(0, 10),
                  source: "INFORMED" as const,
                }
              : null,
          };
        }
        return { transactionId: prior.id, idempotent: true };
      }
      const card = await t.financialAccount.findFirst({
          where: {
            id: cardId,
            workspaceId: w,
            type: "CREDIT_CARD",
            nature: "LIABILITY",
            deletedAt: null,
          },
        }),
        source = await t.financialAccount.findFirst({
          where: {
            id: i.sourceAccountId,
            workspaceId: w,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
            issuedLoansReceivable: { none: {} },
          },
        }),
        statement = statementId
          ? await t.cardStatement.findFirst({
              where: { id: statementId, cardAccountId: cardId, workspaceId: w },
            })
          : null,
        expectation = !statementId && i.applyToNextPayment
          ? await t.cardPaymentExpectation.findFirst({
              where: {
                workspaceId: w,
                cardAccountId: cardId,
                supersededAt: null,
                status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
              },
              orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
            })
          : null;
      if (!card || !source || (statementId && !statement))
        throw new NotFoundError(
          "Tarjeta, cuenta o extracto no encontrado",
          "No encontramos la tarjeta, la cuenta seleccionada o el vencimiento.",
        );
      if (card.currency !== source.currency)
        throw new ConflictError(
          "Moneda incompatible",
          `La cuenta seleccionada debe estar en ${card.currency}.`,
        );
      const amount = D(i.amount),
        dueTarget = expectation
          ? expectation.amount.minus(expectation.paidAmount)
          : statement
          ? (statement.reportedBalance ?? statement.calculatedBalance).minus(statement.paidAmount)
          : new Prisma.Decimal(0),
        appliedToCurrentDue = Prisma.Decimal.min(amount, Prisma.Decimal.max(0, dueTarget)),
        extraPayment = amount.minus(appliedToCurrentDue),
        previousCardBalance = card.currentBalance,
        newCardBalance = card.currentBalance.minus(amount);
      if (amount.gt(source.currentBalance))
        throw new ConflictError(
          "Fondos insuficientes",
          `La cuenta ${source.name} no tiene saldo suficiente para realizar este pago.`,
        );
      if (amount.gt(card.currentBalance))
        throw new ConflictError(
          "Pago superior a la deuda de la tarjeta",
          "El valor supera la deuda actual de la tarjeta.",
        );
      const allocation = {
        totalAmount: amount.toFixed(2),
        appliedToCurrentDue: appliedToCurrentDue.toFixed(2),
        extraPayment: extraPayment.toFixed(2),
        remainingDue: Prisma.Decimal.max(0, dueTarget.minus(appliedToCurrentDue)).toFixed(2),
        previousCardBalance: previousCardBalance.toFixed(2),
        newCardBalance: newCardBalance.toFixed(2),
        statementId: statement?.id ?? null,
        expectationId: expectation?.id ?? null,
      };
      const tr = await t.transaction.create({
        data: {
          workspaceId: w,
          createdBy: u,
          type: "TRANSFER",
          status: "CONFIRMED",
          amount,
          currency: card.currency,
          accountId: source.id,
          destinationAccountId: card.id,
          occurredAt: new Date(i.occurredAt),
          description: `Pago tarjeta ${card.name}`,
          externalReference: i.idempotencyKey,
          metadata: {
            cardPayment: true,
            applyToNextPayment: Boolean(statementId || i.applyToNextPayment),
            ...(statementId ? { statementId } : {}),
            ...(expectation ? { cardPaymentExpectationId: expectation.id } : {}),
            cardPaymentAllocation: allocation,
          },
        },
      });
      await t.financialAccount.update({
        where: { id: source.id },
        data: { currentBalance: { decrement: amount } },
      });
      await t.financialAccount.update({
        where: { id: card.id },
        data: { currentBalance: { decrement: amount } },
      });
      if (statement) {
        const statementTarget = statement.reportedBalance ?? statement.calculatedBalance;
        const paid = Prisma.Decimal.min(
          statementTarget,
          statement.paidAmount.plus(appliedToCurrentDue),
        );
        await t.cardStatement.update({
          where: { id: statement.id },
          data: {
            paidAmount: paid,
            paymentsAmount: { increment: appliedToCurrentDue },
            status: paid.gte(statementTarget) ? "PAID" : "PARTIAL",
          },
        });
        await syncFinancialEvent(t, cardStatementEventWhere(w, statement.id), {
          isCompleted: paid.gte(statementTarget),
          remainingAmount: Prisma.Decimal.max(0, statementTarget.minus(paid)),
        });
      }
      if (expectation) {
        const paid = Prisma.Decimal.min(
          expectation.amount,
          expectation.paidAmount.plus(appliedToCurrentDue),
        );
        await t.cardPaymentExpectation.update({
          where: { id: expectation.id },
          data: {
            paidAmount: paid,
            status: paid.gte(expectation.amount) ? "PAID" : "PARTIAL",
          },
        });
        await t.financialEvent.updateMany({
          where: { workspaceId: w, relatedCardPaymentExpectationId: expectation.id },
          data: {
            amount: Prisma.Decimal.max(0, expectation.amount.minus(paid)),
            isCompleted: paid.gte(expectation.amount),
            updatedAt: new Date(),
          },
        });
      }
      const nextExpectation = await t.cardPaymentExpectation.findFirst({
        where: {
          workspaceId: w,
          cardAccountId: cardId,
          supersededAt: null,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      });
      return {
        transactionId: tr.id,
        idempotent: false,
        ...allocation,
        nextPayment: nextExpectation
          ? {
              amount: nextExpectation.amount.minus(nextExpectation.paidAmount).toFixed(2),
              dueDate: nextExpectation.dueDate.toISOString().slice(0, 10),
              source: "INFORMED" as const,
            }
          : null,
      };
    });
  }
}
export const cardsService = new CardsService();
