import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { estimateCredit } from "./domain/credit-estimator.js";
import {
  generateAmortizationSchedule,
  toEffectiveMonthly,
  calculateFixedPayment,
  calculateNumberOfPeriods,
  calculateRemainingInterest,
} from "./domain/credit-math.js";
import { publicDebt, debtInclude } from "./debts.mapper.js";
import type {
  CreateDebtInput,
  ListDebtsInput,
  PaymentInput,
  PrepaymentInput,
  ReconciliationInput,
  UpdateDebtInput,
} from "./debts.schemas.js";

const D = (x: string | Prisma.Decimal) => new Prisma.Decimal(x);
const date = (x: string | null | undefined) => (x ? new Date(`${x}T00:00:00.000Z`) : null);
const missing = () => new NotFoundError("Crédito no encontrado", "Crédito no encontrado");
const txRetry = <T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  withTransactionRetry(() =>
    db.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    }),
  );
const audit = (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  entityId: string,
  action: string,
  oldData?: Prisma.InputJsonValue,
  newData?: Prisma.InputJsonValue,
) =>
  tx.auditLog.create({
    data: {
      workspaceId,
      userId,
      entityType: "DEBT",
      entityId,
      action,
      ...(oldData ? { oldData } : {}),
      ...(newData ? { newData } : {}),
    },
  });

export class DebtsService {
  constructor(private readonly db: PrismaClient = prisma) {}
  async create(workspaceId: string, userId: string, input: CreateDebtInput) {
    return txRetry(this.db, async (tx) => {
      if (input.liabilityAccountId) {
        const account = await tx.financialAccount.findFirst({
          where: {
            id: input.liabilityAccountId,
            workspaceId,
            nature: "LIABILITY",
            deletedAt: null,
          },
        });
        if (!account || account.currency !== input.currency)
          throw new ConflictError("Cuenta pasiva o moneda incompatible");
      }
      const estimation = estimateCredit({
        originalPrincipal: input.originalAmount,
        ...(input.currentBalance ? { currentBalance: input.currentBalance } : {}),
        ...(input.installmentAmount ? { paymentAmount: input.installmentAmount } : {}),
        ...(input.interestRate ? { interestRate: input.interestRate } : {}),
        ...(input.interestRateBasis ? { interestRateBasis: input.interestRateBasis } : {}),
        ...(input.termMonths ? { totalInstallments: input.termMonths } : {}),
        ...(date(input.disbursementDate)
          ? { disbursementDate: date(input.disbursementDate)! }
          : {}),
        ...(date(input.firstPaymentDate)
          ? { firstPaymentDate: date(input.firstPaymentDate)! }
          : {}),
      });
      const term = input.termMonths ?? estimation.totalInstallments.value;
      const payment = input.installmentAmount
        ? D(input.installmentAmount)
        : estimation.paymentAmount.value;
      const first = date(input.firstPaymentDate);
      const end = estimation.estimatedEndDate.value;
      const debt = await tx.debt.create({
        data: {
          workspaceId,
          name: input.name,
          lenderName: input.lenderName ?? null,
          type: input.type,
          currency: input.currency,
          originalAmount: D(input.originalAmount),
          currentBalance: D(input.currentBalance ?? input.originalAmount),
          interestRate: D(input.interestRate ?? "0"),
          interestRateBasis: input.interestRateBasis ?? "EFFECTIVE_ANNUAL",
          interestType:
            input.interestType ?? (D(input.interestRate ?? "0").isZero() ? "NONE" : "FIXED"),
          termMonths: term,
          installmentAmount: payment,
          disbursementDate: date(input.disbursementDate),
          firstPaymentDate: first,
          estimatedEndDate: end,
          nextDueDate: first,
          paymentDay: input.paymentDay ?? null,
          liabilityAccountId: input.liabilityAccountId ?? null,
          notes: input.notes ?? null,
          metadata: {
            estimation: {
              quality: estimation.overallQuality,
              issues: estimation.issues,
              assumptions: estimation.assumptions,
              sources: {
                payment: estimation.paymentAmount.source,
                rate: estimation.periodicRate.source,
                term: estimation.totalInstallments.source,
              },
            },
          },
        },
        include: debtInclude,
      });
      if (term && payment && first)
        await this.replaceFutureSchedule(tx, debt, 1, D(debt.currentBalance), payment);
      await audit(tx, workspaceId, userId, debt.id, "CREATE", undefined, { name: debt.name });
      return publicDebt(
        (await tx.debt.findUnique({ where: { id: debt.id }, include: debtInclude }))!,
      );
    });
  }
  async list(workspaceId: string, f: ListDebtsInput) {
    const where: Prisma.DebtWhereInput = {
      workspaceId,
      deletedAt: null,
      ...(f.status ? { status: f.status } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.currency ? { currency: f.currency } : {}),
      ...(f.search
        ? {
            OR: [
              { name: { contains: f.search, mode: "insensitive" } },
              { lenderName: { contains: f.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.debt.findMany({
        where,
        orderBy: { [f.sort]: f.order },
        skip: (f.page - 1) * f.limit,
        take: f.limit,
      }),
      this.db.debt.count({ where }),
    ]);
    return {
      items: rows.map(publicDebt),
      page: f.page,
      limit: f.limit,
      total,
      totalPages: Math.ceil(total / f.limit),
    };
  }
  async get(workspaceId: string, id: string) {
    const x = await this.db.debt.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: debtInclude,
    });
    if (!x) throw missing();
    return publicDebt(x);
  }
  async update(workspaceId: string, userId: string, id: string, input: UpdateDebtInput) {
    return txRetry(this.db, async (tx) => {
      const current = await tx.debt.findFirst({ where: { id, workspaceId, deletedAt: null } });
      if (!current) throw missing();
      const data: Prisma.DebtUncheckedUpdateInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.lenderName !== undefined ? { lenderName: input.lenderName } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.interestRateBasis !== undefined
          ? { interestRateBasis: input.interestRateBasis }
          : {}),
        ...(input.interestType !== undefined ? { interestType: input.interestType } : {}),
        ...(input.termMonths !== undefined ? { termMonths: input.termMonths } : {}),
        ...(input.paymentDay !== undefined ? { paymentDay: input.paymentDay } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.originalAmount ? { originalAmount: D(input.originalAmount) } : {}),
        ...(input.currentBalance ? { currentBalance: D(input.currentBalance) } : {}),
        ...(input.interestRate ? { interestRate: D(input.interestRate) } : {}),
        ...(input.installmentAmount !== undefined
          ? { installmentAmount: input.installmentAmount ? D(input.installmentAmount) : null }
          : {}),
        ...(input.disbursementDate !== undefined
          ? { disbursementDate: date(input.disbursementDate) }
          : {}),
        ...(input.firstPaymentDate !== undefined
          ? { firstPaymentDate: date(input.firstPaymentDate) }
          : {}),
      };
      if (input.liabilityAccountId !== undefined)
        data.liabilityAccountId = input.liabilityAccountId;
      const updated = await tx.debt.update({ where: { id }, data, include: debtInclude });
      await audit(
        tx,
        workspaceId,
        userId,
        id,
        "UPDATE",
        { balance: current.currentBalance.toFixed(2) },
        { balance: updated.currentBalance.toFixed(2) },
      );
      return publicDebt(updated);
    });
  }
  async archive(workspaceId: string, userId: string, id: string) {
    return txRetry(this.db, async (tx) => {
      const result = await tx.debt.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: { deletedAt: new Date(), status: "CANCELLED" },
      });
      if (!result.count) throw missing();
      await audit(tx, workspaceId, userId, id, "ARCHIVE");
    });
  }
  private async replaceFutureSchedule(
    tx: Prisma.TransactionClient,
    debt: Prisma.DebtGetPayload<object>,
    start: number,
    balance: Prisma.Decimal,
    payment?: Prisma.Decimal,
  ) {
    if (!debt.termMonths || !debt.firstPaymentDate) return;
    const protectedInstallment = await tx.debtInstallment.findFirst({
      where: {
        workspaceId: debt.workspaceId,
        debtId: debt.id,
        installmentNumber: { gte: start },
        debtPayments: { some: {} },
      },
      select: { id: true },
    });
    if (protectedInstallment)
      throw new ConflictError(
        "El recálculo alcanzaría una cuota con historial de pagos",
        "No se pueden reemplazar cuotas con historial de pagos",
      );
    const rate = toEffectiveMonthly(debt.interestRate, debt.interestRateBasis);
    const schedule = generateAmortizationSchedule({
      principal: balance,
      periodicRate: rate,
      numberOfInstallments: debt.termMonths - start + 1,
      firstPaymentDate:
        start === 1 ? debt.firstPaymentDate : new Date(debt.nextDueDate ?? debt.firstPaymentDate),
      ...(payment ? { paymentAmount: payment } : {}),
    });
    await tx.debtInstallment.deleteMany({
      where: {
        workspaceId: debt.workspaceId,
        debtId: debt.id,
        installmentNumber: { gte: start },
        status: { in: ["PENDING", "OVERDUE", "CANCELLED"] },
      },
    });
    for (const row of schedule) {
      const installment = await tx.debtInstallment.create({
        data: {
          workspaceId: debt.workspaceId,
          debtId: debt.id,
          installmentNumber: start + row.installmentNumber - 1,
          dueDate: row.dueDate,
          openingBalance: row.openingBalance,
          principalAmount: row.principalAmount,
          interestAmount: row.interestAmount,
          insuranceAmount: row.insuranceAmount,
          feeAmount: row.feeAmount,
          totalAmount: row.paymentAmount,
          closingBalance: row.closingBalance,
        },
      });
      await tx.financialEvent.create({
        data: {
          workspaceId: debt.workspaceId,
          type: "DEBT_INSTALLMENT_DUE",
          title: `Cuota ${debt.name}`,
          amount: row.paymentAmount,
          currency: debt.currency,
          startsAt: row.dueDate,
          relatedDebtId: debt.id,
          relatedDebtInstallmentId: installment.id,
        },
      });
    }
  }
  async updateInstallment(
    workspaceId: string,
    userId: string,
    debtId: string,
    installmentId: string,
    amount: string,
    recalculate: boolean,
  ) {
    return txRetry(this.db, async (tx) => {
      const row = await tx.debtInstallment.findFirst({
        where: { id: installmentId, debtId, workspaceId },
      });
      if (!row) throw new NotFoundError("Cuota no encontrada");
      if (row.status === "PAID" || row.status === "PARTIAL")
        throw new ConflictError("Una cuota consolidada no puede modificarse");
      await tx.debtInstallment.update({ where: { id: row.id }, data: { totalAmount: D(amount) } });
      if (recalculate) {
        const debt = await tx.debt.findFirst({ where: { id: debtId, workspaceId } });
        if (debt)
          await this.replaceFutureSchedule(
            tx,
            debt,
            row.installmentNumber + 1,
            row.closingBalance,
            D(amount),
          );
      }
      await audit(tx, workspaceId, userId, debtId, "UPDATE_INSTALLMENT");
    });
  }
  async pay(
    workspaceId: string,
    userId: string,
    debtId: string,
    installmentId: string,
    input: PaymentInput,
  ) {
    try {
      return await txRetry(this.db, async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM debts WHERE id::text=${debtId} AND workspace_id::text=${workspaceId} FOR UPDATE`,
        );
        const existing = await tx.debtPayment.findFirst({
          where: { workspaceId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return { id: existing.id, idempotent: true };
        const debt = await tx.debt.findFirst({
          where: { id: debtId, workspaceId, deletedAt: null, status: "ACTIVE" },
        });
        const installment = await tx.debtInstallment.findFirst({
          where: { id: installmentId, debtId, workspaceId },
        });
        const account = await tx.financialAccount.findFirst({
          where: {
            id: input.accountId,
            workspaceId,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
          },
        });
        if (!debt || !installment) throw missing();
        if (!account || account.currency !== debt.currency)
          throw new ConflictError("Cuenta pagadora o moneda incompatible");
        const amount = D(input.amount);
        const suppliedBreakdown = input.principalAmount !== undefined;
        const previous = await tx.debtPayment.aggregate({
          _sum: {
            principalAmount: true,
            interestAmount: true,
            insuranceAmount: true,
            feeAmount: true,
          },
          where: { workspaceId, installmentId, reversedAt: null },
        });
        let remainder = amount;
        const allocate = (scheduled: Prisma.Decimal, paid: Prisma.Decimal | null) => {
          const value = Prisma.Decimal.min(
            remainder,
            Prisma.Decimal.max(0, scheduled.minus(paid ?? 0)),
          );
          remainder = remainder.minus(value);
          return value;
        };
        const feeAmount = suppliedBreakdown
          ? D(input.feeAmount ?? "0")
          : allocate(installment.feeAmount, previous._sum.feeAmount);
        const insuranceAmount = suppliedBreakdown
          ? D(input.insuranceAmount ?? "0")
          : allocate(installment.insuranceAmount, previous._sum.insuranceAmount);
        const interestAmount = suppliedBreakdown
          ? D(input.interestAmount ?? "0")
          : allocate(installment.interestAmount, previous._sum.interestAmount);
        const principalAmount = suppliedBreakdown
          ? D(input.principalAmount ?? "0")
          : allocate(installment.principalAmount, previous._sum.principalAmount);
        const extraPaymentAmount = suppliedBreakdown
          ? D(input.extraPaymentAmount ?? "0")
          : remainder;
        const components = principalAmount
          .plus(interestAmount)
          .plus(insuranceAmount)
          .plus(feeAmount)
          .plus(extraPaymentAmount);
        if (!components.eq(amount)) throw new ConflictError("El desglose no coincide con el pago");
        if (
          amount.gt(installment.totalAmount.minus(installment.paidAmount).plus(extraPaymentAmount))
        )
          throw new ConflictError("Pago superior no permitido");
        const transaction = await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type: "DEBT_PAYMENT",
            status: "CONFIRMED",
            amount,
            currency: debt.currency,
            accountId: account.id,
            destinationAccountId: debt.liabilityAccountId,
            occurredAt: new Date(input.paidAt),
            description: `Pago ${debt.name}`,
            externalReference: input.idempotencyKey,
          },
        });
        const paid = installment.paidAmount.plus(amount.minus(extraPaymentAmount));
        await tx.financialAccount.update({
          where: { id: account.id },
          data: { currentBalance: { decrement: amount } },
        });
        if (debt.liabilityAccountId)
          await tx.financialAccount.update({
            where: { id: debt.liabilityAccountId },
            data: {
              currentBalance: {
                decrement: principalAmount.plus(extraPaymentAmount),
              },
            },
          });
        const balance = Prisma.Decimal.max(
          0,
          debt.currentBalance.minus(principalAmount).minus(extraPaymentAmount),
        );
        await tx.debt.update({
          where: { id: debt.id },
          data: { currentBalance: balance, status: balance.isZero() ? "PAID" : "ACTIVE" },
        });
        await tx.debtInstallment.update({
          where: { id: installment.id },
          data: {
            paidAmount: paid,
            status: paid.gte(installment.totalAmount) ? "PAID" : "PARTIAL",
            paidAt: paid.gte(installment.totalAmount) ? new Date(input.paidAt) : null,
          },
        });
        const next = await tx.debtInstallment.findFirst({
          where: { workspaceId, debtId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
          orderBy: { dueDate: "asc" },
        });
        await tx.debt.update({
          where: { id: debt.id },
          data: { nextDueDate: next?.dueDate ?? null },
        });
        const payment = await tx.debtPayment.create({
          data: {
            workspaceId,
            debtId,
            installmentId,
            transactionId: transaction.id,
            paidAt: new Date(input.paidAt),
            totalAmount: amount,
            principalAmount,
            interestAmount,
            insuranceAmount,
            feeAmount,
            extraPaymentAmount,
            idempotencyKey: input.idempotencyKey,
          },
        });
        await audit(tx, workspaceId, userId, debtId, "PAY", undefined, { paymentId: payment.id });
        return { id: payment.id, idempotent: false };
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.db.debtPayment.findFirst({
          where: { workspaceId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return { id: existing.id, idempotent: true };
      }
      throw error;
    }
  }
  async reverse(
    workspaceId: string,
    userId: string,
    debtId: string,
    paymentId: string,
    reason: string,
  ) {
    return txRetry(this.db, async (tx) => {
      const p = await tx.debtPayment.findFirst({
        where: { id: paymentId, debtId, workspaceId },
        include: { transactions: true, debtInstallments: true, debts: true },
      });
      if (!p) throw new NotFoundError("Pago no encontrado");
      if (p.reversedAt) throw new ConflictError("Pago ya revertido");
      if (!p.transactions.accountId) throw new ConflictError("Pago sin cuenta");
      await tx.financialAccount.update({
        where: { id: p.transactions.accountId },
        data: { currentBalance: { increment: p.totalAmount } },
      });
      if (p.debts.liabilityAccountId)
        await tx.financialAccount.update({
          where: { id: p.debts.liabilityAccountId },
          data: { currentBalance: { increment: p.principalAmount.plus(p.extraPaymentAmount) } },
        });
      await tx.debt.update({
        where: { id: debtId },
        data: {
          currentBalance: { increment: p.principalAmount.plus(p.extraPaymentAmount) },
          status: "ACTIVE",
        },
      });
      if (p.debtInstallments) {
        const paid = Prisma.Decimal.max(
          0,
          p.debtInstallments.paidAmount.minus(p.totalAmount.minus(p.extraPaymentAmount)),
        );
        await tx.debtInstallment.update({
          where: { id: p.debtInstallments.id },
          data: { paidAmount: paid, status: paid.isZero() ? "PENDING" : "PARTIAL", paidAt: null },
        });
      }
      await tx.transaction.update({
        where: { id: p.transactionId },
        data: {
          status: "CANCELLED",
          deletedAt: new Date(),
          notes: reason,
          version: { increment: 1 },
        },
      });
      await tx.debtPayment.update({
        where: { id: p.id },
        data: { reversedAt: new Date(), reversedBy: userId },
      });
      await audit(tx, workspaceId, userId, debtId, "REVERSE_PAYMENT", undefined, {
        paymentId,
        reason,
      });
    });
  }
  simulatePrepayment(workspaceId: string, debtId: string, input: PrepaymentInput) {
    return this.db.debt
      .findFirst({ where: { id: debtId, workspaceId, deletedAt: null } })
      .then((debt) => {
        if (!debt) throw missing();
        const rate = toEffectiveMonthly(debt.interestRate, debt.interestRateBasis),
          after = Prisma.Decimal.max(0, debt.currentBalance.minus(input.amount));
        const beforeTerm = debt.termMonths ?? 0,
          beforePayment = debt.installmentAmount ?? new Prisma.Decimal(0);
        const afterTerm =
          input.strategy === "REDUCE_TERM" && beforePayment.gt(0)
            ? calculateNumberOfPeriods(after, rate, beforePayment)
            : beforeTerm;
        const afterPayment =
          input.strategy === "REDUCE_PAYMENT" && beforeTerm > 0
            ? calculateFixedPayment({
                principal: after,
                periodicRate: rate,
                numberOfInstallments: beforeTerm,
              })
            : beforePayment;
        return {
          balanceBefore: debt.currentBalance.toFixed(2),
          balanceAfter: after.toFixed(2),
          installmentsBefore: beforeTerm,
          installmentsAfter: afterTerm,
          paymentBefore: beforePayment.toFixed(2),
          paymentAfter: afterPayment.toFixed(2),
          remainingInterestBefore:
            beforeTerm && debt.firstPaymentDate
              ? calculateRemainingInterest(
                  generateAmortizationSchedule({
                    principal: debt.currentBalance,
                    periodicRate: rate,
                    numberOfInstallments: beforeTerm,
                    firstPaymentDate: debt.firstPaymentDate,
                    paymentAmount: beforePayment,
                  }),
                  0,
                ).toFixed(2)
              : null,
          remainingInterestAfter:
            afterTerm && debt.firstPaymentDate
              ? calculateRemainingInterest(
                  generateAmortizationSchedule({
                    principal: after,
                    periodicRate: rate,
                    numberOfInstallments: afterTerm,
                    firstPaymentDate: debt.firstPaymentDate,
                    paymentAmount: afterPayment,
                  }),
                  0,
                ).toFixed(2)
              : null,
        };
      });
  }
  async applyPrepayment(
    workspaceId: string,
    userId: string,
    debtId: string,
    input: PrepaymentInput,
  ) {
    if (!input.accountId || !input.occurredAt || !input.idempotencyKey)
      throw new ConflictError("Para aplicar el abono se requieren cuenta, fecha e idempotencia");
    const accountId = input.accountId;
    const occurredAt = input.occurredAt;
    const idempotencyKey = input.idempotencyKey;
    return txRetry(this.db, async (tx) => {
      const duplicate = await tx.debtPayment.findFirst({
        where: { workspaceId, idempotencyKey },
      });
      if (duplicate) return { paymentId: duplicate.id, idempotent: true };
      const debt = await tx.debt.findFirst({
        where: { id: debtId, workspaceId, status: "ACTIVE", deletedAt: null },
      });
      const account = await tx.financialAccount.findFirst({
        where: {
          id: accountId,
          workspaceId,
          nature: "ASSET",
          isActive: true,
          deletedAt: null,
        },
      });
      if (!debt || !account) throw missing();
      const amount = D(input.amount);
      if (amount.gt(debt.currentBalance)) throw new ConflictError("Abono superior al saldo");
      if (account.currency !== debt.currency) throw new ConflictError("Moneda incompatible");
      const tr = await tx.transaction.create({
        data: {
          workspaceId,
          createdBy: userId,
          type: "DEBT_PAYMENT",
          status: "CONFIRMED",
          amount,
          currency: debt.currency,
          accountId: account.id,
          destinationAccountId: debt.liabilityAccountId,
          occurredAt: new Date(occurredAt),
          description: `Abono ${debt.name}`,
          externalReference: idempotencyKey,
        },
      });
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { decrement: amount } },
      });
      if (debt.liabilityAccountId)
        await tx.financialAccount.update({
          where: { id: debt.liabilityAccountId },
          data: { currentBalance: { decrement: amount } },
        });
      const balance = debt.currentBalance.minus(amount);
      const payment = await tx.debtPayment.create({
        data: {
          workspaceId,
          debtId,
          transactionId: tr.id,
          paidAt: new Date(occurredAt),
          totalAmount: amount,
          principalAmount: new Prisma.Decimal(0),
          extraPaymentAmount: amount,
          idempotencyKey,
        },
      });
      const periodicRate = toEffectiveMonthly(debt.interestRate, debt.interestRateBasis);
      const future = await tx.debtInstallment.findMany({
        where: { workspaceId, debtId, status: { in: ["PENDING", "OVERDUE"] } },
        orderBy: { installmentNumber: "asc" },
      });
      let term = future.length;
      let installment = debt.installmentAmount ?? null;
      if (input.strategy === "REDUCE_TERM" && installment)
        term = calculateNumberOfPeriods(balance, periodicRate, installment);
      if (input.strategy === "REDUCE_PAYMENT" && term > 0)
        installment = calculateFixedPayment({
          principal: balance,
          periodicRate,
          numberOfInstallments: term,
        });
      const totalTerm = future[0] ? future[0].installmentNumber + term - 1 : term;
      await tx.debt.update({
        where: { id: debtId },
        data: {
          currentBalance: balance,
          installmentAmount: installment,
          termMonths: totalTerm,
          status: balance.isZero() ? "PAID" : "ACTIVE",
        },
      });
      if (!balance.isZero() && future[0])
        await this.replaceFutureSchedule(
          tx,
          {
            ...debt,
            currentBalance: balance,
            installmentAmount: installment,
            termMonths: future[0].installmentNumber + term - 1,
            nextDueDate: future[0].dueDate,
          },
          future[0].installmentNumber,
          balance,
          installment ?? undefined,
        );
      await audit(tx, workspaceId, userId, debtId, "PREPAYMENT", undefined, {
        amount: amount.toFixed(2),
        strategy: input.strategy,
      });
      return { paymentId: payment.id, idempotent: false };
    });
  }
  async reconcile(workspaceId: string, userId: string, debtId: string, input: ReconciliationInput) {
    return txRetry(this.db, async (tx) => {
      const debt = await tx.debt.findFirst({ where: { id: debtId, workspaceId, deletedAt: null } });
      if (!debt) throw missing();
      const reported = D(input.reportedBalance);
      const rec = await tx.debtReconciliation.create({
        data: {
          workspaceId,
          debtId,
          calculatedBalance: debt.currentBalance,
          reportedBalance: reported,
          difference: reported.minus(debt.currentBalance),
          previousRate: debt.interestRate,
          newRate: input.newRate ? D(input.newRate) : null,
          previousPayment: debt.installmentAmount,
          newPayment: input.newPayment ? D(input.newPayment) : null,
          effectiveDate: date(input.effectiveDate)!,
          source: input.source,
          notes: input.notes ?? null,
          createdBy: userId,
        },
      });
      await tx.debt.update({
        where: { id: debtId },
        data: {
          currentBalance: reported,
          ...(input.newRate ? { interestRate: D(input.newRate) } : {}),
          ...(input.newPayment ? { installmentAmount: D(input.newPayment) } : {}),
        },
      });
      const firstFuture = await tx.debtInstallment.findFirst({
        where: { workspaceId, debtId, status: { in: ["PENDING", "OVERDUE"] } },
        orderBy: { installmentNumber: "asc" },
      });
      if (firstFuture) {
        const projected = {
          ...debt,
          currentBalance: reported,
          interestRate: input.newRate ? D(input.newRate) : debt.interestRate,
          installmentAmount: input.newPayment ? D(input.newPayment) : debt.installmentAmount,
          nextDueDate: firstFuture.dueDate,
        };
        await this.replaceFutureSchedule(
          tx,
          projected,
          firstFuture.installmentNumber,
          reported,
          projected.installmentAmount ?? undefined,
        );
      }
      await audit(tx, workspaceId, userId, debtId, "RECONCILE");
      return { id: rec.id, difference: rec.difference.toFixed(2) };
    });
  }
}
export const debtsService = new DebtsService();
