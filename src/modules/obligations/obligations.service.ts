import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import type { CreateObligationInput, UpdateObligationInput } from "./obligations.schemas.js";
const D = (x: string) => new Prisma.Decimal(x),
  day = (x: string) => new Date(`${x}T00:00:00Z`);
const pub = <
  T extends {
    expectedAmount?: Prisma.Decimal;
    amount?: Prisma.Decimal;
    paidAmount?: Prisma.Decimal;
  },
>(
  x: T,
) => ({
  ...x,
  expectedAmount: x.expectedAmount?.toFixed(2),
  amount: x.amount?.toFixed(2),
  paidAmount: x.paidAmount?.toFixed(2),
});
export class ObligationsService {
  constructor(private db: PrismaClient = prisma) {}
  private tx<T>(f: (t: Prisma.TransactionClient) => Promise<T>) {
    return withTransactionRetry(() => this.db.$transaction(f, { isolationLevel: "Serializable" }));
  }
  async create(w: string, i: CreateObligationInput) {
    return this.tx(async (t) => {
      const rule = await t.recurrenceRule.create({
        data: {
          workspaceId: w,
          frequency: i.frequency,
          intervalValue: i.intervalValue,
          dayOfWeek: i.dayOfWeek ?? null,
          dayOfMonth: i.dayOfMonth ?? null,
          startsOn: day(i.startsOn),
          endsOn: i.endsOn ? day(i.endsOn) : null,
          nextRunAt: day(i.startsOn),
        },
      });
      return pub(
        await t.recurringObligation.create({
          data: {
            workspaceId: w,
            recurrenceRuleId: rule.id,
            name: i.name,
            description: i.description ?? null,
            expectedAmount: D(i.expectedAmount),
            currency: i.currency,
            amountType: i.amountType,
            paymentAccountId: i.paymentAccountId ?? null,
            categoryId: i.categoryId ?? null,
            remindersEnabled: i.remindersEnabled,
          },
        }),
      );
    });
  }
  list(w: string) {
    return this.db.recurringObligation
      .findMany({
        where: { workspaceId: w, deletedAt: null },
        include: { recurrenceRules: true, occurrences: { orderBy: { dueDate: "asc" } } },
      })
      .then((a) => a.map(pub));
  }
  async get(w: string, id: string) {
    const x = await this.db.recurringObligation.findFirst({
      where: { id, workspaceId: w, deletedAt: null },
      include: { recurrenceRules: true, occurrences: true },
    });
    if (!x) throw new NotFoundError("Obligación no encontrada");
    return pub(x);
  }
  async update(w: string, id: string, i: UpdateObligationInput) {
    const data: Prisma.RecurringObligationUncheckedUpdateManyInput = {
      ...(i.name !== undefined ? { name: i.name } : {}),
      ...(i.description !== undefined ? { description: i.description } : {}),
      ...(i.expectedAmount !== undefined ? { expectedAmount: D(i.expectedAmount) } : {}),
      ...(i.currency !== undefined ? { currency: i.currency } : {}),
      ...(i.amountType !== undefined ? { amountType: i.amountType } : {}),
      ...(i.paymentAccountId !== undefined ? { paymentAccountId: i.paymentAccountId } : {}),
      ...(i.categoryId !== undefined ? { categoryId: i.categoryId } : {}),
      ...(i.remindersEnabled !== undefined ? { remindersEnabled: i.remindersEnabled } : {}),
      ...(i.status !== undefined ? { status: i.status } : {}),
    };
    const x = await this.db.recurringObligation.updateMany({
      where: { id, workspaceId: w, deletedAt: null },
      data,
    });
    if (!x.count) throw new NotFoundError("Obligación no encontrada");
    return this.get(w, id);
  }
  async archive(w: string, id: string) {
    const x = await this.db.recurringObligation.updateMany({
      where: { id, workspaceId: w, deletedAt: null },
      data: { deletedAt: new Date(), status: "CANCELLED" },
    });
    if (!x.count) throw new NotFoundError("Obligación no encontrada");
  }
  async occurrence(w: string, id: string, dueDate: string, amount?: string) {
    const o = await this.db.recurringObligation.findFirst({
      where: { id, workspaceId: w, deletedAt: null, status: "ACTIVE" },
    });
    if (!o) throw new NotFoundError("Obligación no encontrada");
    const occurrence = await this.db.obligationOccurrence.upsert({
      where: {
        workspaceId_obligationId_dueDate: {
          workspaceId: w,
          obligationId: id,
          dueDate: day(dueDate),
        },
      },
      create: {
        workspaceId: w,
        obligationId: id,
        dueDate: day(dueDate),
        amount: D(amount ?? o.expectedAmount.toFixed(2)),
      },
      update: { ...(amount ? { amount: D(amount) } : {}) },
    });
    const existingEvent = await this.db.financialEvent.findFirst({
      where: {
        workspaceId: w,
        type: "RECURRING_OBLIGATION",
        relatedObligationId: o.id,
        startsAt: occurrence.dueDate,
      },
    });
    if (!existingEvent)
      await this.db.financialEvent.create({
        data: {
          workspaceId: w,
          type: "RECURRING_OBLIGATION",
          title: o.name,
          amount: occurrence.amount,
          currency: o.currency,
          startsAt: occurrence.dueDate,
          relatedObligationId: o.id,
          recurrenceRuleId: o.recurrenceRuleId,
        },
      });
    return pub(occurrence);
  }
  async pay(
    w: string,
    u: string,
    id: string,
    occurrenceId: string,
    input: { accountId: string; amount: string; occurredAt: string; idempotencyKey: string },
  ) {
    return this.tx(async (t) => {
      const duplicate = await t.transaction.findFirst({
        where: { workspaceId: w, externalReference: input.idempotencyKey },
      });
      if (duplicate) return { transactionId: duplicate.id, idempotent: true };
      const o = await t.obligationOccurrence.findFirst({
        where: { id: occurrenceId, obligationId: id, workspaceId: w },
        include: { obligation: true },
      });
      const a = await t.financialAccount.findFirst({
        where: {
          id: input.accountId,
          workspaceId: w,
          nature: "ASSET",
          isActive: true,
          deletedAt: null,
        },
      });
      if (!o || !a) throw new NotFoundError("Ocurrencia o cuenta no encontrada");
      if (a.currency !== o.obligation.currency) throw new ConflictError("Moneda incompatible");
      const amount = D(input.amount),
        remaining = o.amount.minus(o.paidAmount);
      if (amount.gt(remaining)) throw new ConflictError("Pago superior no permitido");
      const tr = await t.transaction.create({
        data: {
          workspaceId: w,
          createdBy: u,
          type: "EXPENSE",
          status: "CONFIRMED",
          amount,
          currency: a.currency,
          accountId: a.id,
          categoryId: o.obligation.categoryId,
          occurredAt: new Date(input.occurredAt),
          description: `Pago ${o.obligation.name}`,
          externalReference: input.idempotencyKey,
          metadata: { obligationOccurrenceId: o.id },
        },
      });
      await t.financialAccount.update({
        where: { id: a.id },
        data: { currentBalance: { decrement: amount } },
      });
      const paid = o.paidAmount.plus(amount);
      await t.obligationOccurrence.update({
        where: { id: o.id },
        data: {
          paidAmount: paid,
          status: paid.gte(o.amount) ? "PAID" : "PARTIAL",
          paidAt: paid.gte(o.amount) ? new Date(input.occurredAt) : null,
          paymentAccountId: a.id,
          transactionId: tr.id,
        },
      });
      return { transactionId: tr.id, idempotent: false };
    });
  }
}
export const obligationsService = new ObligationsService();
