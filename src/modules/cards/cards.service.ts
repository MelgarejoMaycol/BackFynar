import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { generateAmortizationSchedule } from "../debts/domain/credit-math.js";
import type { z } from "zod";
import type { cardPaymentSchema, purchaseSchema, statementSchema } from "./cards.schemas.js";
type PurchaseInput = z.infer<typeof purchaseSchema>;
type StatementInput = z.infer<typeof statementSchema>;
type CardPaymentInput = z.infer<typeof cardPaymentSchema>;
const D = (x: string) => new Prisma.Decimal(x),
  day = (x: string) => new Date(`${x}T00:00:00Z`),
  pub = <T>(x: T): T =>
    JSON.parse(JSON.stringify(x, (_k, v) => (v instanceof Prisma.Decimal ? v.toFixed(2) : v)));
export class CardsService {
  constructor(private db: PrismaClient = prisma) {}
  private tx<T>(f: (t: Prisma.TransactionClient) => Promise<T>) {
    return withTransactionRetry(() => this.db.$transaction(f, { isolationLevel: "Serializable" }));
  }
  async list(w: string) {
    const cards = await this.db.financialAccount.findMany({
      where: { workspaceId: w, type: "CREDIT_CARD", nature: "LIABILITY", deletedAt: null },
    });
    return cards.map((c) => {
      const limit = c.creditLimit ?? new Prisma.Decimal(0),
        used = Prisma.Decimal.max(0, c.currentBalance);
      return {
        ...pub(c),
        usedCredit: used.toFixed(2),
        availableCredit: Prisma.Decimal.max(0, limit.minus(used)).toFixed(2),
        utilization: limit.gt(0) ? used.div(limit).mul(100).toDecimalPlaces(2).toString() : "0",
      };
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
      const purchase = await t.cardPurchase.create({
        data: {
          workspaceId: w,
          cardAccountId: card.id,
          transactionId: tr.id,
          installmentCount: i.installmentCount,
          periodicRate: D(i.periodicRate),
          outstandingBalance: amount,
        },
      });
      const schedule = generateAmortizationSchedule({
        principal: amount,
        periodicRate: D(i.periodicRate),
        numberOfInstallments: i.installmentCount,
        firstPaymentDate: day(i.firstDueDate),
      });
      for (const row of schedule)
        await t.cardPurchaseInstallment.create({
          data: {
            workspaceId: w,
            cardPurchaseId: purchase.id,
            installmentNumber: row.installmentNumber,
            dueDate: row.dueDate,
            principalAmount: row.principalAmount,
            interestAmount: row.interestAmount,
            totalAmount: row.paymentAmount,
          },
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
    return this.db.cardPurchase
      .findMany({
        where: { workspaceId: w, cardAccountId: cardId },
        include: {
          transaction: { select: { description: true, amount: true, occurredAt: true } },
          installments: { orderBy: { installmentNumber: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      })
      .then(pub);
  }
  async statement(w: string, cardId: string, i: StatementInput) {
    return this.tx(async (t) => {
      const card = await t.financialAccount.findFirst({
        where: { id: cardId, workspaceId: w, type: "CREDIT_CARD", deletedAt: null },
      });
      if (!card) throw new NotFoundError("Tarjeta no encontrada");
      const purchases = await t.transaction.aggregate({
        _sum: { amount: true },
        where: {
          workspaceId: w,
          accountId: cardId,
          type: "EXPENSE",
          status: "CONFIRMED",
          deletedAt: null,
          occurredAt: {
            gte: day(i.periodStart),
            lt: new Date(day(i.periodEnd).getTime() + 86_400_000),
          },
        },
      });
      const p = purchases._sum.amount ?? new Prisma.Decimal(0),
        calc = D(i.previousBalance).plus(p).plus(i.interestAmount).plus(i.feeAmount);
      const statement = await t.cardStatement.create({
        data: {
          workspaceId: w,
          cardAccountId: cardId,
          periodStart: day(i.periodStart),
          periodEnd: day(i.periodEnd),
          dueDate: day(i.dueDate),
          previousBalance: D(i.previousBalance),
          purchasesAmount: p,
          interestAmount: D(i.interestAmount),
          feeAmount: D(i.feeAmount),
          calculatedBalance: calc,
          reportedBalance: i.reportedBalance ? D(i.reportedBalance) : null,
          minimumPayment: D(i.minimumPayment),
        },
      });
      await t.financialEvent.create({
        data: {
          workspaceId: w,
          type: "CARD_PAYMENT",
          title: `Pago tarjeta ${card.name}`,
          amount: i.reportedBalance ? D(i.reportedBalance) : calc,
          currency: card.currency,
          startsAt: day(i.dueDate),
        },
      });
      return pub(statement);
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
          },
        }),
        statement = await t.cardStatement.findFirst({
          where: { id: statementId, cardAccountId: cardId, workspaceId: w },
        });
      if (!card || !source || !statement)
        throw new NotFoundError("Tarjeta, cuenta o extracto no encontrado");
      if (card.currency !== source.currency) throw new ConflictError("Moneda incompatible");
      const amount = D(i.amount),
        target = statement.reportedBalance ?? statement.calculatedBalance;
      if (amount.gt(target.minus(statement.paidAmount)) || amount.gt(card.currentBalance))
        throw new ConflictError("Pago superior no permitido");
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
          metadata: { cardPayment: true, statementId },
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
      const paid = statement.paidAmount.plus(amount);
      await t.cardStatement.update({
        where: { id: statement.id },
        data: {
          paidAmount: paid,
          paymentsAmount: { increment: amount },
          status: paid.gte(target) ? "PAID" : "PARTIAL",
        },
      });
      return { transactionId: tr.id, idempotent: false };
    });
  }
}
export const cardsService = new CardsService();
