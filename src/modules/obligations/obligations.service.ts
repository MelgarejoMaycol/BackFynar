import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import type {
  CreateObligationInput,
  UpdateObligationInput,
  UpdateOccurrencePaymentInput,
} from "./obligations.schemas.js";
import {
  obligationEventWhere,
  syncFinancialEvent,
} from "../liabilities/financial-event-sync.service.js";
const D = (x: string) => new Prisma.Decimal(x),
  day = (x: string) => new Date(`${x}T00:00:00Z`);
const nextRecurrenceDate = (
  current: Date,
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
  interval: number,
) => {
  const next = new Date(current);
  if (frequency === "DAILY") next.setUTCDate(next.getUTCDate() + interval);
  if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7 * interval);
  if (frequency === "YEARLY") next.setUTCFullYear(next.getUTCFullYear() + interval);
  if (frequency === "MONTHLY") {
    const wantedDay = next.getUTCDate();
    const targetMonth = next.getUTCMonth() + interval;
    const targetYear = next.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    next.setUTCFullYear(targetYear, normalizedMonth, Math.min(wantedDay, lastDay));
  }
  return next;
};
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
  private async lockOccurrence(t: Prisma.TransactionClient, w: string, id: string) {
    await t.$queryRaw`SELECT id FROM obligation_occurrences WHERE workspace_id = ${w}::uuid AND id = ${id}::uuid FOR UPDATE`;
  }
  private async lockAccounts(t: Prisma.TransactionClient, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    if (unique.length)
      await t.$queryRaw`SELECT id FROM financial_accounts WHERE id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  }
  private async applyPaymentSource(
    t: Prisma.TransactionClient,
    account: {
      id: string;
      type: string;
      nature: string;
      currentBalance: Prisma.Decimal;
      creditLimit: Prisma.Decimal | null;
    },
    amount: Prisma.Decimal,
  ) {
    if (account.type === "CREDIT_CARD") {
      if (!account.creditLimit || account.currentBalance.plus(amount).gt(account.creditLimit))
        throw new ConflictError(
          "Cupo insuficiente",
          "La tarjeta no tiene cupo suficiente para registrar este pago.",
        );
      await t.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: amount } },
      });
      return;
    }
    if (account.nature !== "ASSET") throw new NotFoundError("Cuenta pagadora no encontrada");
    await t.financialAccount.update({
      where: { id: account.id },
      data: { currentBalance: { decrement: amount } },
    });
  }
  private async restorePaymentSource(
    t: Prisma.TransactionClient,
    account: { id: string; type: string },
    amount: Prisma.Decimal,
  ) {
    await t.financialAccount.update({
      where: { id: account.id },
      data: {
        currentBalance:
          account.type === "CREDIT_CARD" ? { decrement: amount } : { increment: amount },
      },
    });
  }
  private async recalculateOccurrence(
    t: Prisma.TransactionClient,
    w: string,
    occurrenceId: string,
  ) {
    const occurrence = await t.obligationOccurrence.findFirst({
      where: { id: occurrenceId, workspaceId: w },
    });
    if (!occurrence) throw new NotFoundError("Ocurrencia no encontrada");
    const payments = await t.obligationPayment.findMany({
      where: { workspaceId: w, occurrenceId, reversedAt: null },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    });
    const paidAmount = payments.reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Prisma.Decimal(0),
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const status = paidAmount.gte(occurrence.amount)
      ? "PAID"
      : paidAmount.gt(0)
        ? "PARTIAL"
        : occurrence.dueDate < today
          ? "OVERDUE"
          : "PENDING";
    const latest = payments[0] ?? null;
    await t.obligationOccurrence.update({
      where: { id: occurrenceId },
      data: {
        paidAmount,
        status,
        paidAt: status === "PAID" ? (latest?.paidAt ?? null) : null,
        paymentAccountId: latest?.accountId ?? null,
        transactionId: latest?.transactionId ?? null,
      },
    });
    await syncFinancialEvent(t, obligationEventWhere(w, occurrenceId), {
      isCompleted: status === "PAID",
      remainingAmount: Prisma.Decimal.max(0, occurrence.amount.minus(paidAmount)),
    });
    return { occurrence, paidAmount, status };
  }
  private audit(
    t: Prisma.TransactionClient,
    input: {
      workspaceId: string;
      userId: string;
      paymentId: string;
      action: string;
      oldData?: Prisma.InputJsonValue;
      newData?: Prisma.InputJsonValue;
    },
  ) {
    return t.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        entityType: "OBLIGATION_PAYMENT",
        entityId: input.paymentId,
        action: input.action,
        ...(input.oldData !== undefined ? { oldData: input.oldData } : {}),
        ...(input.newData !== undefined ? { newData: input.newData } : {}),
      },
    });
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
      const obligation = await t.recurringObligation.create({
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
      });
      const firstDueDate = day(i.startsOn);
      const occurrence = await t.obligationOccurrence.create({
        data: {
          workspaceId: w,
          obligationId: obligation.id,
          dueDate: firstDueDate,
          amount: D(i.expectedAmount),
        },
      });
      await t.financialEvent.create({
        data: {
          workspaceId: w,
          type: "RECURRING_OBLIGATION",
          title: obligation.name,
          amount: occurrence.amount,
          currency: obligation.currency,
          startsAt: occurrence.dueDate,
          relatedObligationId: obligation.id,
          relatedObligationOccurrenceId: occurrence.id,
          recurrenceRuleId: rule.id,
        },
      });
      await t.recurrenceRule.update({
        where: { id: rule.id },
        data: { nextRunAt: nextRecurrenceDate(firstDueDate, i.frequency, i.intervalValue) },
      });
      return pub(obligation);
    });
  }
  list(w: string, archived = false) {
    return this.db.recurringObligation
      .findMany({
        where: {
          workspaceId: w,
          deletedAt: archived ? { not: null } : null,
        },
        include: {
          recurrenceRules: true,
          occurrences: {
            orderBy: { dueDate: "desc" },
            include: {
              payments: {
                include: { account: { select: { id: true, name: true, isActive: true } } },
                orderBy: { paidAt: "desc" },
              },
            },
          },
        },
      })
      .then((a) => a.map(pub));
  }
  async get(w: string, id: string) {
    const x = await this.db.recurringObligation.findFirst({
      where: { id, workspaceId: w },
      include: {
        recurrenceRules: true,
        occurrences: {
          orderBy: { dueDate: "desc" },
          include: {
            payments: {
              include: { account: { select: { id: true, name: true, isActive: true } } },
              orderBy: { paidAt: "desc" },
            },
          },
        },
      },
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
    if (i.status === "CANCELLED" || i.status === "COMPLETED") {
      await this.db.obligationOccurrence.updateMany({
        where: {
          workspaceId: w,
          obligationId: id,
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        data: { status: "CANCELLED" },
      });
      await this.db.financialEvent.updateMany({
        where: { workspaceId: w, relatedObligationId: id, isCompleted: false },
        data: { isCompleted: true, updatedAt: new Date() },
      });
    }
    return this.get(w, id);
  }
  async remove(w: string, u: string, id: string) {
    return withTransactionRetry(() =>
      this.db.$transaction(
        async (t) => {
          const current = await t.recurringObligation.findFirst({
            where: { id, workspaceId: w, deletedAt: null },
            select: { id: true, name: true, recurrenceRuleId: true },
          });
          if (!current) throw new NotFoundError("Obligación no encontrada");
          const [paidOccurrences, transactions] = await Promise.all([
            t.obligationOccurrence.count({
              where: { workspaceId: w, obligationId: id, paidAmount: { gt: 0 } },
            }),
            t.obligationOccurrence.count({
              where: { workspaceId: w, obligationId: id, transactionId: { not: null } },
            }),
          ]);
          const dependencies = { paidOccurrences, transactions };
          await t.recurringObligation.update({
            where: { id },
            data: { deletedAt: new Date(), status: "CANCELLED" },
          });
          await t.obligationOccurrence.updateMany({
            where: {
              workspaceId: w,
              obligationId: id,
              status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
            },
            data: { status: "CANCELLED" },
          });
          await t.financialEvent.updateMany({
            where: { workspaceId: w, relatedObligationId: id, isCompleted: false },
            data: { isCompleted: true, updatedAt: new Date() },
          });
          await recordDeletionAudit(t, {
            workspaceId: w,
            userId: u,
            entityType: "RECURRING_OBLIGATION",
            entityId: id,
            mode: "LOGICAL",
            name: current.name,
            dependencies,
          });
          return { mode: "LOGICAL" as const, dependencies };
        },
        { isolationLevel: "Serializable" },
      ),
    );
  }
  async restore(w: string, id: string) {
    return this.tx(async (t) => {
      const obligation = await t.recurringObligation.findFirst({
        where: { id, workspaceId: w, deletedAt: { not: null } },
        include: { recurrenceRules: true },
      });
      if (!obligation) throw new NotFoundError("Obligación archivada no encontrada");

      const rule = obligation.recurrenceRules;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      let nextDueDate = new Date(rule.startsOn);
      while (nextDueDate < today)
        nextDueDate = nextRecurrenceDate(nextDueDate, rule.frequency, rule.intervalValue);

      await t.recurringObligation.update({
        where: { id },
        data: { deletedAt: null, status: "ACTIVE" },
      });

      if (!rule.endsOn || nextDueDate <= rule.endsOn) {
        const existingOccurrence = await t.obligationOccurrence.findUnique({
          where: {
            workspaceId_obligationId_dueDate: {
              workspaceId: w,
              obligationId: id,
              dueDate: nextDueDate,
            },
          },
        });
        const restoredStatus = existingOccurrence?.paidAmount.gte(existingOccurrence.amount)
          ? "PAID"
          : existingOccurrence?.paidAmount.gt(0)
            ? "PARTIAL"
            : "PENDING";
        const occurrence = await t.obligationOccurrence.upsert({
          where: {
            workspaceId_obligationId_dueDate: {
              workspaceId: w,
              obligationId: id,
              dueDate: nextDueDate,
            },
          },
          create: {
            workspaceId: w,
            obligationId: id,
            dueDate: nextDueDate,
            amount: obligation.expectedAmount,
          },
          update: {
            status: restoredStatus,
          },
        });
        await t.financialEvent.upsert({
          where: {
            workspaceId_relatedObligationOccurrenceId: {
              workspaceId: w,
              relatedObligationOccurrenceId: occurrence.id,
            },
          },
          create: {
            workspaceId: w,
            type: "RECURRING_OBLIGATION",
            title: obligation.name,
            amount: occurrence.amount,
            currency: obligation.currency,
            startsAt: nextDueDate,
            relatedObligationId: id,
            relatedObligationOccurrenceId: occurrence.id,
            recurrenceRuleId: rule.id,
          },
          update: {
            title: obligation.name,
            amount: Prisma.Decimal.max(0, occurrence.amount.minus(occurrence.paidAmount)),
            startsAt: nextDueDate,
            isCompleted: restoredStatus === "PAID",
            updatedAt: new Date(),
          },
        });
        await t.recurrenceRule.update({
          where: { id: rule.id },
          data: {
            nextRunAt: nextRecurrenceDate(nextDueDate, rule.frequency, rule.intervalValue),
          },
        });
      }
      const restored = await t.recurringObligation.findUniqueOrThrow({
        where: { id },
        include: { recurrenceRules: true, occurrences: true },
      });
      return pub(restored);
    });
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
          relatedObligationOccurrenceId: occurrence.id,
          recurrenceRuleId: o.recurrenceRuleId,
        },
      });
    else
      await this.db.financialEvent.update({
        where: { id: existingEvent.id },
        data: {
          relatedObligationOccurrenceId: occurrence.id,
          amount: Prisma.Decimal.max(0, occurrence.amount.minus(occurrence.paidAmount)),
          isCompleted: occurrence.status === "PAID" || occurrence.status === "CANCELLED",
          updatedAt: new Date(),
        },
      });
    return pub(occurrence);
  }
  async pay(
    w: string,
    u: string,
    id: string,
    occurrenceId: string,
    input: {
      accountId: string;
      amount: string;
      occurredAt: string;
      idempotencyKey: string;
      note?: string | null | undefined;
    },
  ) {
    return this.tx(async (t) => {
      await this.lockOccurrence(t, w, occurrenceId);
      const o = await t.obligationOccurrence.findFirst({
        where: { id: occurrenceId, obligationId: id, workspaceId: w },
        include: { obligation: { include: { recurrenceRules: true } } },
      });
      if (!o) throw new NotFoundError("Ocurrencia no encontrada");
      if (o?.obligation.deletedAt || o?.obligation.status !== "ACTIVE")
        throw new ConflictError(
          "Esta obligación está archivada. Restáurala antes de registrar nuevos pagos.",
          "Esta obligación está archivada. Restáurala antes de registrar nuevos pagos.",
        );
      const duplicate = await t.transaction.findFirst({
        where: { workspaceId: w, externalReference: input.idempotencyKey },
      });
      if (duplicate) return { transactionId: duplicate.id, idempotent: true };
      const a = await t.financialAccount.findFirst({
        where: {
          id: input.accountId,
          workspaceId: w,
          isActive: true,
          deletedAt: null,
          OR: [{ nature: "ASSET" }, { type: "CREDIT_CARD", nature: "LIABILITY" }],
          issuedLoansReceivable: { none: {} },
        },
      });
      if (!o || !a) throw new NotFoundError("Ocurrencia o cuenta no encontrada");
      if (a.currency !== o.obligation.currency) throw new ConflictError("Moneda incompatible");
      await this.lockAccounts(t, [a.id]);
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
          metadata: {
            sourceType: "OBLIGATION_PAYMENT",
            obligationId: o.obligationId,
            obligationOccurrenceId: o.id,
          },
        },
      });
      await this.applyPaymentSource(t, a, amount);
      const payment = await t.obligationPayment.create({
        data: {
          workspaceId: w,
          occurrenceId: o.id,
          accountId: a.id,
          transactionId: tr.id,
          amount,
          paidAt: new Date(input.occurredAt),
          note: input.note ?? null,
        },
      });
      await t.transaction.update({
        where: { id: tr.id },
        data: {
          metadata: {
            sourceType: "OBLIGATION_PAYMENT",
            sourceId: payment.id,
            obligationId: o.obligationId,
            obligationOccurrenceId: o.id,
          },
        },
      });
      const { status } = await this.recalculateOccurrence(t, w, o.id);
      await this.audit(t, {
        workspaceId: w,
        userId: u,
        paymentId: payment.id,
        action: "PAYMENT_CREATED",
        newData: {
          accountId: a.id,
          amount: amount.toFixed(2),
          occurredAt: input.occurredAt,
          transactionId: tr.id,
        },
      });
      if (status === "PAID" && o.obligation.status === "ACTIVE") {
        const rule = o.obligation.recurrenceRules;
        const nextDueDate = nextRecurrenceDate(o.dueDate, rule.frequency, rule.intervalValue);
        if (!rule.endsOn || nextDueDate <= rule.endsOn) {
          const nextOccurrence = await t.obligationOccurrence.upsert({
            where: {
              workspaceId_obligationId_dueDate: {
                workspaceId: w,
                obligationId: o.obligationId,
                dueDate: nextDueDate,
              },
            },
            create: {
              workspaceId: w,
              obligationId: o.obligationId,
              dueDate: nextDueDate,
              amount: o.obligation.expectedAmount,
            },
            update: {},
          });
          await t.financialEvent.upsert({
            where: {
              workspaceId_relatedObligationOccurrenceId: {
                workspaceId: w,
                relatedObligationOccurrenceId: nextOccurrence.id,
              },
            },
            create: {
              workspaceId: w,
              type: "RECURRING_OBLIGATION",
              title: o.obligation.name,
              amount: nextOccurrence.amount,
              currency: o.obligation.currency,
              startsAt: nextDueDate,
              relatedObligationId: o.obligationId,
              relatedObligationOccurrenceId: nextOccurrence.id,
              recurrenceRuleId: rule.id,
            },
            update: {
              amount: nextOccurrence.amount,
              startsAt: nextDueDate,
              isCompleted: false,
              updatedAt: new Date(),
            },
          });
          await t.recurrenceRule.update({
            where: { id: rule.id },
            data: {
              nextRunAt: nextRecurrenceDate(nextDueDate, rule.frequency, rule.intervalValue),
            },
          });
        }
      }
      return { paymentId: payment.id, transactionId: tr.id, idempotent: false };
    });
  }

  async updatePayment(
    w: string,
    u: string,
    obligationId: string,
    paymentId: string,
    input: UpdateOccurrencePaymentInput,
  ) {
    return this.tx(async (t) => {
      const current = await t.obligationPayment.findFirst({
        where: {
          id: paymentId,
          workspaceId: w,
          occurrence: { obligationId },
        },
        include: { occurrence: { include: { obligation: true } }, transaction: true },
      });
      if (!current) throw new NotFoundError("Pago no encontrado");
      await this.lockOccurrence(t, w, current.occurrenceId);
      if (current.reversedAt)
        throw new ConflictError("Pago revertido", "Un pago revertido no se puede editar.");
      if (current.version !== input.version)
        throw new ConflictError(
          "Pago modificado",
          "El pago cambió. Actualiza e inténtalo de nuevo.",
        );

      const accountId = input.accountId ?? current.accountId;
      await this.lockAccounts(t, [current.accountId, accountId]);
      const [currentAccount, account] = await Promise.all([
        t.financialAccount.findFirst({ where: { id: current.accountId, workspaceId: w } }),
        t.financialAccount.findFirst({
          where: {
            id: accountId,
            workspaceId: w,
            isActive: true,
            deletedAt: null,
            OR: [{ nature: "ASSET" }, { type: "CREDIT_CARD", nature: "LIABILITY" }],
            issuedLoansReceivable: { none: {} },
          },
        }),
      ]);
      if (!currentAccount || !account)
        throw new NotFoundError("Cuenta o tarjeta activa no encontrada");
      if (account.currency !== current.occurrence.obligation.currency)
        throw new ConflictError("Moneda incompatible");

      const amount = input.amount ? D(input.amount) : current.amount;
      const otherPayments = await t.obligationPayment.aggregate({
        where: {
          workspaceId: w,
          occurrenceId: current.occurrenceId,
          reversedAt: null,
          id: { not: current.id },
        },
        _sum: { amount: true },
      });
      if (amount.plus(otherPayments._sum.amount ?? 0).gt(current.occurrence.amount))
        throw new ConflictError("Pago superior no permitido");

      await this.restorePaymentSource(t, currentAccount, current.amount);
      const accountAfterRestore = await t.financialAccount.findFirstOrThrow({
        where: { id: accountId, workspaceId: w },
      });
      await this.applyPaymentSource(t, accountAfterRestore, amount);
      const paidAt = input.occurredAt ? new Date(input.occurredAt) : current.paidAt;
      const updatedCount = await t.obligationPayment.updateMany({
        where: { id: current.id, workspaceId: w, version: input.version, reversedAt: null },
        data: {
          accountId,
          amount,
          paidAt,
          ...(input.note !== undefined ? { note: input.note } : {}),
          version: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1)
        throw new ConflictError(
          "Pago modificado",
          "El pago cambió. Actualiza e inténtalo de nuevo.",
        );
      await t.transaction.update({
        where: { id: current.transactionId },
        data: {
          accountId,
          amount,
          currency: account.currency,
          occurredAt: paidAt,
          ...(input.note !== undefined ? { notes: input.note } : {}),
          version: { increment: 1 },
        },
      });
      await this.recalculateOccurrence(t, w, current.occurrenceId);
      const accountChanged = accountId !== current.accountId;
      await this.audit(t, {
        workspaceId: w,
        userId: u,
        paymentId: current.id,
        action: accountChanged ? "PAYMENT_ACCOUNT_CHANGED" : "PAYMENT_UPDATED",
        oldData: {
          accountId: current.accountId,
          amount: current.amount.toFixed(2),
          occurredAt: current.paidAt.toISOString(),
          note: current.note,
        },
        newData: {
          accountId,
          amount: amount.toFixed(2),
          occurredAt: paidAt.toISOString(),
          note: input.note !== undefined ? input.note : current.note,
        },
      });
      return t.obligationPayment.findUniqueOrThrow({
        where: { id: current.id },
        include: { account: { select: { id: true, name: true, isActive: true } } },
      });
    });
  }

  async reversePayment(
    w: string,
    u: string,
    obligationId: string,
    paymentId: string,
    input: { reason: string; version: number },
  ) {
    return this.tx(async (t) => {
      const current = await t.obligationPayment.findFirst({
        where: { id: paymentId, workspaceId: w, occurrence: { obligationId } },
        include: { transaction: true },
      });
      if (!current) throw new NotFoundError("Pago no encontrado");
      await this.lockOccurrence(t, w, current.occurrenceId);
      if (current.reversedAt) return { mode: "REVERSED" as const, idempotent: true };
      if (current.version !== input.version)
        throw new ConflictError(
          "Pago modificado",
          "El pago cambió. Actualiza e inténtalo de nuevo.",
        );
      await this.lockAccounts(t, [current.accountId]);
      const sourceAccount = await t.financialAccount.findFirst({
        where: { id: current.accountId, workspaceId: w },
      });
      if (!sourceAccount) throw new NotFoundError("Cuenta pagadora no encontrada");
      await this.restorePaymentSource(t, sourceAccount, current.amount);
      const now = new Date();
      const reversed = await t.obligationPayment.updateMany({
        where: { id: current.id, workspaceId: w, version: input.version, reversedAt: null },
        data: {
          reversedAt: now,
          reversedBy: u,
          reversalReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (reversed.count !== 1)
        throw new ConflictError(
          "Pago modificado",
          "El pago cambió. Actualiza e inténtalo de nuevo.",
        );
      await t.transaction.update({
        where: { id: current.transactionId },
        data: { status: "CANCELLED", deletedAt: now, version: { increment: 1 } },
      });
      await this.recalculateOccurrence(t, w, current.occurrenceId);
      await this.audit(t, {
        workspaceId: w,
        userId: u,
        paymentId: current.id,
        action: "PAYMENT_REVERSED",
        oldData: {
          accountId: current.accountId,
          amount: current.amount.toFixed(2),
          transactionId: current.transactionId,
        },
        newData: { reversedAt: now.toISOString(), reason: input.reason },
      });
      return { mode: "REVERSED" as const, idempotent: false };
    });
  }
}
export const obligationsService = new ObligationsService();
