import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../database/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors/app-error.js";
import {
  addFrequency,
  calculateLendingSchedule,
  summarizeLendingSchedule,
} from "./lending.math.js";
import type {
  CreateLoanInput,
  ListLoansInput,
  PaymentInput,
  SimulationInput,
  UpdateLoanInput,
} from "./lending.schemas.js";

const decimal = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);
const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type LoanLock = {
  id: string;
  person_id: string;
  person_name: string;
  receivable_account_id: string;
  source_account_id: string | null;
  currency: string;
  current_principal: Prisma.Decimal;
  status: string;
};
type InstallmentLock = {
  id: string;
  installment_number: number;
  due_date: Date;
  principal_amount: Prisma.Decimal;
  principal_paid: Prisma.Decimal;
  interest_amount: Prisma.Decimal;
  interest_paid: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  total_paid: Prisma.Decimal;
};
type PaymentLock = {
  id: string;
  installment_id: string;
  receiving_account_id: string;
  principal_transaction_id: string | null;
  interest_transaction_id: string | null;
  total_received: Prisma.Decimal;
  principal_received: Prisma.Decimal;
  interest_received: Prisma.Decimal;
  reversed_at: Date | null;
};
type PublicLoan = Record<string, unknown> & {
  installments: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
};

export class LendingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  simulate(input: SimulationInput) {
    const schedule = calculateLendingSchedule(input);
    const summary = summarizeLendingSchedule(schedule);
    const first = input.firstPaymentDate
      ? new Date(`${input.firstPaymentDate}T00:00:00.000Z`)
      : null;
    return {
      ...summary,
      ratePeriod: input.frequency,
      schedule: schedule.map((row, index) => ({
        ...row,
        dueDate: first ? dateOnly(addFrequency(first, input.frequency, index)) : null,
      })),
    };
  }

  private async refreshStatuses(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    loanId?: string,
  ) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE issued_loan_installments i SET
        status = CASE
          WHEN total_paid >= total_amount THEN 'PAID'
          WHEN due_date < CURRENT_DATE AND total_paid > 0 THEN 'OVERDUE'
          WHEN due_date < CURRENT_DATE THEN 'OVERDUE'
          WHEN total_paid > 0 THEN 'PARTIAL'
          ELSE 'PENDING'
        END,
        updated_at = now()
      WHERE workspace_id=${workspaceId}::uuid
        ${loanId ? Prisma.sql`AND loan_id=${loanId}::uuid` : Prisma.empty}
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE issued_loans l SET
        next_due_date = (
          SELECT MIN(i.due_date) FROM issued_loan_installments i
          WHERE i.workspace_id=l.workspace_id AND i.loan_id=l.id AND i.total_paid < i.total_amount
        ),
        status = CASE
          WHEN l.archived_at IS NOT NULL THEN 'ARCHIVED'
          WHEN l.current_principal = 0 AND NOT EXISTS (
            SELECT 1 FROM issued_loan_installments i WHERE i.workspace_id=l.workspace_id AND i.loan_id=l.id AND i.total_paid < i.total_amount
          ) THEN 'PAID'
          WHEN EXISTS (
            SELECT 1 FROM issued_loan_installments i WHERE i.workspace_id=l.workspace_id AND i.loan_id=l.id AND i.due_date < CURRENT_DATE AND i.total_paid < i.total_amount
          ) THEN 'OVERDUE'
          ELSE 'ACTIVE'
        END,
        updated_at=now()
      WHERE l.workspace_id=${workspaceId}::uuid
        ${loanId ? Prisma.sql`AND l.id=${loanId}::uuid` : Prisma.empty}
    `);
  }

  async list(
    workspaceId: string,
    input: ListLoansInput = {},
  ): Promise<Array<Record<string, unknown>>> {
    await this.db.$transaction((tx) => this.refreshStatuses(tx, workspaceId));
    const search = input.q ? `%${input.q}%` : null;
    const status = input.status ?? "ACTIVE";
    const rows = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT l.id, l.person_id AS "personId", p.name AS "personName", l.currency,
        l.original_principal AS "originalPrincipal", l.current_principal AS "currentPrincipal",
        l.rate_percent AS "ratePercent", l.method, l.frequency, l.term_count AS "termCount",
        l.installment_amount AS "installmentAmount", l.expected_interest AS "expectedInterest",
        l.expected_total AS "expectedTotal", l.interest_received AS "interestReceived",
        l.principal_received AS "principalReceived", l.next_due_date AS "nextDueDate",
        l.estimated_end_date AS "estimatedEndDate", l.status, l.created_at AS "createdAt"
      FROM issued_loans l
      JOIN financial_people p ON p.workspace_id=l.workspace_id AND p.id=l.person_id
      WHERE l.workspace_id=${workspaceId}::uuid
        AND (${search}::text IS NULL OR p.name ILIKE ${search})
        AND CASE
          WHEN ${status}='ALL' THEN true
          WHEN ${status}='ACTIVE' THEN l.status IN ('ACTIVE','OVERDUE')
          ELSE l.status=${status}
        END
      ORDER BY CASE l.status WHEN 'OVERDUE' THEN 0 WHEN 'ACTIVE' THEN 1 WHEN 'PAID' THEN 2 ELSE 3 END,
        l.next_due_date ASC NULLS LAST, l.created_at DESC
    `);
    return rows.map((row) => ({
      ...row,
      nextDueDate: row.nextDueDate instanceof Date ? dateOnly(row.nextDueDate) : row.nextDueDate,
      estimatedEndDate:
        row.estimatedEndDate instanceof Date
          ? dateOnly(row.estimatedEndDate)
          : row.estimatedEndDate,
    }));
  }

  async summary(workspaceId: string) {
    await this.db.$transaction((tx) => this.refreshStatuses(tx, workspaceId));
    const currencies = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT currency,
        COALESCE(SUM(current_principal) FILTER (WHERE status IN ('ACTIVE','OVERDUE')),0) AS "principalPending",
        COALESCE(SUM(expected_interest-interest_received) FILTER (WHERE status IN ('ACTIVE','OVERDUE')),0) AS "interestPending",
        COALESCE(SUM(interest_received),0) AS "interestReceived",
        COUNT(*) FILTER (WHERE status IN ('ACTIVE','OVERDUE')) AS "activeCount"
      FROM issued_loans WHERE workspace_id=${workspaceId}::uuid AND archived_at IS NULL
      GROUP BY currency ORDER BY currency
    `);
    const upcoming = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT i.loan_id AS "loanId", p.name AS "personName", i.id AS "installmentId",
        i.due_date AS "dueDate", i.total_amount-i.total_paid AS amount, l.currency, i.status
      FROM issued_loan_installments i
      JOIN issued_loans l ON l.workspace_id=i.workspace_id AND l.id=i.loan_id
      JOIN financial_people p ON p.workspace_id=l.workspace_id AND p.id=l.person_id
      WHERE i.workspace_id=${workspaceId}::uuid AND i.total_paid<i.total_amount AND l.archived_at IS NULL
      ORDER BY i.due_date LIMIT 8
    `);
    return {
      currencies: currencies.map((row) => ({ ...row, activeCount: Number(row.activeCount ?? 0) })),
      upcoming: upcoming.map((row) => ({
        ...row,
        dueDate: row.dueDate instanceof Date ? dateOnly(row.dueDate) : row.dueDate,
      })),
    };
  }

  async get(workspaceId: string, loanId: string): Promise<PublicLoan> {
    await this.db.$transaction((tx) => this.refreshStatuses(tx, workspaceId, loanId));
    const loans = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT l.id, l.person_id AS "personId", p.name AS "personName", p.relationship,
        l.receivable_account_id AS "receivableAccountId", ra.name AS "receivableAccountName",
        l.source_account_id AS "sourceAccountId", sa.name AS "sourceAccountName", l.currency,
        l.original_principal AS "originalPrincipal", l.current_principal AS "currentPrincipal",
        l.rate_percent AS "ratePercent", l.method, l.frequency, l.term_count AS "termCount",
        l.installment_amount AS "installmentAmount", l.expected_interest AS "expectedInterest",
        l.expected_total AS "expectedTotal", l.principal_received AS "principalReceived",
        l.interest_received AS "interestReceived", l.disbursement_date AS "disbursementDate",
        l.first_payment_date AS "firstPaymentDate", l.next_due_date AS "nextDueDate",
        l.estimated_end_date AS "estimatedEndDate", l.status, l.notes, l.created_at AS "createdAt",
        l.updated_at AS "updatedAt", l.archived_at AS "archivedAt"
      FROM issued_loans l
      JOIN financial_people p ON p.workspace_id=l.workspace_id AND p.id=l.person_id
      JOIN financial_accounts ra ON ra.workspace_id=l.workspace_id AND ra.id=l.receivable_account_id
      LEFT JOIN financial_accounts sa ON sa.workspace_id=l.workspace_id AND sa.id=l.source_account_id
      WHERE l.workspace_id=${workspaceId}::uuid AND l.id=${loanId}::uuid LIMIT 1
    `);
    if (!loans[0]) throw new NotFoundError("Préstamo no encontrado");
    const installments = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate",
        opening_principal AS "openingPrincipal", principal_amount AS "principalAmount",
        interest_amount AS "interestAmount", total_amount AS "totalAmount",
        principal_paid AS "principalPaid", interest_paid AS "interestPaid", total_paid AS "totalPaid",
        closing_principal AS "closingPrincipal", status, paid_at AS "paidAt"
      FROM issued_loan_installments WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid
      ORDER BY installment_number
    `);
    const payments = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, installment_id AS "installmentId", receiving_account_id AS "receivingAccountId",
        total_received AS "totalReceived", principal_received AS "principalReceived",
        interest_received AS "interestReceived", occurred_at AS "occurredAt", notes,
        reversed_at AS "reversedAt", reversal_reason AS "reversalReason"
      FROM issued_loan_payments WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid
      ORDER BY occurred_at DESC, created_at DESC
    `);
    const loan = loans[0]!;
    for (const key of [
      "disbursementDate",
      "firstPaymentDate",
      "nextDueDate",
      "estimatedEndDate",
    ] as const) {
      if (loan[key] instanceof Date) loan[key] = dateOnly(loan[key] as Date);
    }
    return {
      ...loan,
      installments: installments.map((row) => ({
        ...row,
        dueDate: row.dueDate instanceof Date ? dateOnly(row.dueDate) : row.dueDate,
      })),
      payments,
    };
  }

  async create(workspaceId: string, userId: string, input: CreateLoanInput) {
    const simulation = this.simulate(input);
    const principal = decimal(input.principal);
    const firstPayment = new Date(`${input.firstPaymentDate}T00:00:00.000Z`);
    const endDate = addFrequency(firstPayment, input.frequency, input.termCount - 1);
    const loanId = await this.db.$transaction(
      async (tx) => {
        const id = randomUUID();
        const person = await tx.financialPerson.findFirst({
          where: { id: input.personId, workspaceId, isActive: true, archivedAt: null },
        });
        if (!person) throw new NotFoundError("Persona financiera no encontrada o archivada");
        const source = input.sourceAccountId
          ? await tx.financialAccount.findFirst({
              where: {
                id: input.sourceAccountId,
                workspaceId,
                nature: "ASSET",
                isActive: true,
                deletedAt: null,
                issuedLoansReceivable: { none: {} },
              },
            })
          : null;
        if (input.sourceAccountId && !source)
          throw new NotFoundError("Cuenta de origen no encontrada o archivada");
        if (source?.currency !== undefined && source.currency !== input.currency)
          throw new ValidationError("La moneda del préstamo y la cuenta de origen deben coincidir");
        if (source) {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM financial_accounts WHERE workspace_id=${workspaceId}::uuid AND id=${source.id}::uuid FOR UPDATE`,
          );
          const current = await tx.financialAccount.findUnique({ where: { id: source.id } });
          if (!current || current.currentBalance.lt(principal))
            throw new ConflictError(
              "Fondos insuficientes",
              "No tienes saldo suficiente para desembolsar este préstamo.",
            );
        }
        const receivable = await tx.financialAccount.create({
          data: {
            workspaceId,
            name: `Préstamo a ${person.name} · ${randomUUID().slice(0, 8)}`,
            type: "LOAN",
            nature: "ASSET",
            currency: input.currency,
            openingBalance: source ? 0 : principal,
            currentBalance: source ? 0 : principal,
            includeInNetWorth: true,
            icon: "HandCoins",
          },
        });
        if (source) {
          await tx.financialAccount.update({
            where: { id: source.id },
            data: { currentBalance: { decrement: principal } },
          });
          await tx.financialAccount.update({
            where: { id: receivable.id },
            data: { currentBalance: { increment: principal } },
          });
          await tx.transaction.create({
            data: {
              workspaceId,
              createdBy: userId,
              type: "TRANSFER",
              status: "CONFIRMED",
              amount: principal,
              currency: input.currency,
              accountId: source.id,
              destinationAccountId: receivable.id,
              occurredAt: new Date(`${input.disbursementDate}T12:00:00.000Z`),
              description: `Desembolso de préstamo a ${person.name}`,
              metadata: { lending: true, loanId: id, role: "DISBURSEMENT" },
            },
          });
        }
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO issued_loans (id,workspace_id,person_id,receivable_account_id,source_account_id,currency,
          original_principal,current_principal,rate_percent,method,frequency,term_count,installment_amount,
          expected_interest,expected_total,disbursement_date,first_payment_date,next_due_date,
          estimated_end_date,notes,created_by)
        VALUES (${id}::uuid,${workspaceId}::uuid,${person.id}::uuid,${receivable.id}::uuid,${source?.id ?? null}::uuid,
          ${input.currency},${principal},${principal},${input.ratePercent},${input.method},${input.frequency},
          ${input.termCount},${decimal(simulation.installmentAmount)},${decimal(simulation.totalInterest)},
          ${decimal(simulation.totalReceivable)},${input.disbursementDate}::date,${input.firstPaymentDate}::date,
          ${input.firstPaymentDate}::date,${dateOnly(endDate)}::date,${input.notes ?? null},${userId}::uuid)
      `);
        for (const row of simulation.schedule) {
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO issued_loan_installments (workspace_id,loan_id,installment_number,due_date,
            opening_principal,principal_amount,interest_amount,total_amount,closing_principal)
          VALUES (${workspaceId}::uuid,${id}::uuid,${row.installmentNumber},${row.dueDate}::date,
            ${decimal(row.openingPrincipal)},${decimal(row.principalAmount)},${decimal(row.interestAmount)},
            ${decimal(row.totalAmount)},${decimal(row.closingPrincipal)})
        `);
        }
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "ISSUED_LOAN",
            entityId: id,
            action: "CREATE",
            newData: json({ personId: person.id, principal: input.principal, historical: !source }),
          },
        });
        return id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.get(workspaceId, loanId);
  }

  async update(workspaceId: string, userId: string, loanId: string, input: UpdateLoanInput) {
    if (input.personId) {
      const person = await this.db.financialPerson.findFirst({
        where: { id: input.personId, workspaceId, isActive: true, archivedAt: null },
      });
      if (!person) throw new NotFoundError("Persona financiera no encontrada o archivada");
    }
    const changes: Prisma.Sql[] = [];
    if (input.personId !== undefined) changes.push(Prisma.sql`person_id=${input.personId}::uuid`);
    if (input.notes !== undefined) changes.push(Prisma.sql`notes=${input.notes ?? null}`);
    const changed = await this.db.$transaction(async (tx) => {
      const count = await tx.$executeRaw(
        Prisma.sql`UPDATE issued_loans SET ${Prisma.join(changes, ",")},updated_at=now() WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid AND archived_at IS NULL`,
      );
      if (count)
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "ISSUED_LOAN",
            entityId: loanId,
            action: "UPDATE",
            newData: json(input),
          },
        });
      return count;
    });
    if (!changed) throw new NotFoundError("Préstamo no encontrado");
    return this.get(workspaceId, loanId);
  }

  async pay(
    workspaceId: string,
    userId: string,
    loanId: string,
    installmentId: string | null,
    input: PaymentInput,
  ): Promise<PublicLoan & { paymentId: string | null; paymentIds: string[]; idempotent: boolean }> {
    const amount = decimal(input.amount);
    let paymentId: string | null = null;
    const paymentIds: string[] = [];
    let idempotent = false;
    await this.db.$transaction(
      async (tx) => {
        const existing = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM issued_loan_payments WHERE workspace_id=${workspaceId}::uuid AND idempotency_key=${input.idempotencyKey} LIMIT 1`,
        );
        if (existing[0]) {
          paymentId = existing[0].id;
          paymentIds.push(existing[0].id);
          idempotent = true;
          return;
        }
        const loans = await tx.$queryRaw<LoanLock[]>(Prisma.sql`
        SELECT l.id,l.person_id,p.name AS person_name,l.receivable_account_id,l.source_account_id,l.currency,l.current_principal,l.status
        FROM issued_loans l JOIN financial_people p ON p.workspace_id=l.workspace_id AND p.id=l.person_id
        WHERE l.workspace_id=${workspaceId}::uuid AND l.id=${loanId}::uuid AND l.archived_at IS NULL FOR UPDATE OF l
      `);
        const loan = loans[0];
        if (!loan) throw new NotFoundError("Préstamo no encontrado");
        if (loan.status === "PAID")
          throw new ConflictError(
            "Préstamo pagado",
            "Este préstamo ya no tiene cobros pendientes.",
          );
        const installments = await tx.$queryRaw<InstallmentLock[]>(Prisma.sql`
        SELECT id,installment_number,due_date,principal_amount,principal_paid,interest_amount,interest_paid,total_amount,total_paid
        FROM issued_loan_installments
        WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid AND total_paid<total_amount
        ORDER BY installment_number
        FOR UPDATE
      `);
        if (!installments.length)
          throw new ConflictError(
            "Préstamo pagado",
            "Este préstamo ya no tiene cobros pendientes.",
          );
        if (installmentId && installments[0]!.id !== installmentId) {
          if (installments.some((installment) => installment.id === installmentId))
            throw new ConflictError(
              "Cuota anterior pendiente",
              "Los cobros deben aplicarse en el orden del plan de pagos.",
            );
          throw new NotFoundError("Cuota no encontrada o ya pagada");
        }
        const account = await tx.financialAccount.findFirst({
          where: {
            id: input.receivingAccountId,
            workspaceId,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
            issuedLoansReceivable: { none: {} },
          },
        });
        if (!account) throw new NotFoundError("Cuenta receptora no encontrada o archivada");
        if (account.currency !== loan.currency)
          throw new ValidationError("La moneda de la cuenta receptora no coincide");
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM financial_accounts WHERE workspace_id=${workspaceId}::uuid AND id IN (${loan.receivable_account_id}::uuid,${account.id}::uuid) ORDER BY id FOR UPDATE`,
        );
        const totalRemaining = installments.reduce(
          (total, installment) =>
            total.plus(decimal(installment.total_amount).minus(installment.total_paid)),
          decimal(0),
        );
        if (amount.gt(totalRemaining))
          throw new ConflictError(
            "Cobro superior al saldo pendiente",
            "El cobro no puede superar el total pendiente del préstamo.",
          );
        let amountToAllocate = amount;
        const allocations: Array<{
          installment: InstallmentLock;
          amount: Prisma.Decimal;
          principal: Prisma.Decimal;
          interest: Prisma.Decimal;
        }> = [];
        for (const installment of installments) {
          if (amountToAllocate.lte(0)) break;
          const pending = decimal(installment.total_amount).minus(installment.total_paid);
          const allocated = Prisma.Decimal.min(amountToAllocate, pending);
          const interestRemaining = decimal(installment.interest_amount).minus(
            installment.interest_paid,
          );
          const interest = Prisma.Decimal.min(allocated, Prisma.Decimal.max(0, interestRemaining));
          allocations.push({
            installment,
            amount: allocated,
            principal: allocated.minus(interest),
            interest,
          });
          amountToAllocate = amountToAllocate.minus(allocated);
        }
        const principalPart = allocations.reduce(
          (total, allocation) => total.plus(allocation.principal),
          decimal(0),
        );
        const interestPart = allocations.reduce(
          (total, allocation) => total.plus(allocation.interest),
          decimal(0),
        );
        const receivable = await tx.financialAccount.findFirst({
          where: { id: loan.receivable_account_id, workspaceId },
        });
        if (!receivable || receivable.currentBalance.lt(principalPart))
          throw new ConflictError(
            "Saldo por cobrar inconsistente",
            "El saldo contable del préstamo no permite aplicar este cobro.",
          );
        const occurredAt = new Date(input.occurredAt ?? new Date().toISOString());
        for (const [index, allocation] of allocations.entries()) {
          let principalTransactionId: string | null = null;
          let interestTransactionId: string | null = null;
          if (allocation.principal.gt(0)) {
            await tx.financialAccount.update({
              where: { id: receivable.id },
              data: { currentBalance: { decrement: allocation.principal } },
            });
            await tx.financialAccount.update({
              where: { id: account.id },
              data: { currentBalance: { increment: allocation.principal } },
            });
            principalTransactionId = (
              await tx.transaction.create({
                data: {
                  workspaceId,
                  createdBy: userId,
                  type: "TRANSFER",
                  status: "CONFIRMED",
                  amount: allocation.principal,
                  currency: loan.currency,
                  accountId: receivable.id,
                  destinationAccountId: account.id,
                  occurredAt,
                  description: `Recuperación de capital · ${loan.person_name}`,
                  notes: input.notes ?? null,
                  metadata: {
                    lending: true,
                    loanId,
                    installmentId: allocation.installment.id,
                    role: "PRINCIPAL_COLLECTION",
                  },
                },
              })
            ).id;
          }
          if (allocation.interest.gt(0)) {
            await tx.financialAccount.update({
              where: { id: account.id },
              data: { currentBalance: { increment: allocation.interest } },
            });
            interestTransactionId = (
              await tx.transaction.create({
                data: {
                  workspaceId,
                  createdBy: userId,
                  type: "INCOME",
                  status: "CONFIRMED",
                  amount: allocation.interest,
                  currency: loan.currency,
                  accountId: account.id,
                  occurredAt,
                  description: `Interés recibido · ${loan.person_name}`,
                  notes: input.notes ?? null,
                  metadata: {
                    lending: true,
                    loanId,
                    installmentId: allocation.installment.id,
                    role: "INTEREST_INCOME",
                  },
                },
              })
            ).id;
          }
          const totalPaid = decimal(allocation.installment.total_paid).plus(allocation.amount);
          const paid = totalPaid.gte(allocation.installment.total_amount);
          await tx.$executeRaw(Prisma.sql`
          UPDATE issued_loan_installments SET principal_paid=principal_paid+${allocation.principal},interest_paid=interest_paid+${allocation.interest},
            total_paid=total_paid+${allocation.amount},status=${paid ? "PAID" : "PARTIAL"},paid_at=${paid ? occurredAt : null},updated_at=now()
          WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid AND id=${allocation.installment.id}::uuid
        `);
          const idempotencyKey =
            index === 0
              ? input.idempotencyKey
              : `${input.idempotencyKey.slice(0, 100)}:${index + 1}`;
          const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO issued_loan_payments (workspace_id,loan_id,installment_id,receiving_account_id,
            principal_transaction_id,interest_transaction_id,total_received,principal_received,interest_received,
            occurred_at,notes,idempotency_key,created_by)
          VALUES (${workspaceId}::uuid,${loanId}::uuid,${allocation.installment.id}::uuid,${account.id}::uuid,
            ${principalTransactionId}::uuid,${interestTransactionId}::uuid,${allocation.amount},${allocation.principal},${allocation.interest},
            ${occurredAt},${input.notes ?? null},${idempotencyKey},${userId}::uuid) RETURNING id
        `);
          const insertedId = inserted[0]!.id;
          paymentIds.push(insertedId);
          paymentId ??= insertedId;
        }
        await tx.$executeRaw(
          Prisma.sql`UPDATE issued_loans SET current_principal=current_principal-${principalPart},principal_received=principal_received+${principalPart},interest_received=interest_received+${interestPart},updated_at=now() WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid`,
        );
        await this.refreshStatuses(tx, workspaceId, loanId);
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "ISSUED_LOAN_PAYMENT",
            entityId: paymentId!,
            action: "CREATE",
            newData: json({
              loanId,
              installmentId,
              amount: input.amount,
              principal: principalPart.toString(),
              interest: interestPart.toString(),
              paymentIds,
            }),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { ...(await this.get(workspaceId, loanId)), paymentId, paymentIds, idempotent };
  }

  async reverse(
    workspaceId: string,
    userId: string,
    loanId: string,
    paymentId: string,
    reason: string,
  ) {
    await this.db.$transaction(
      async (tx) => {
        const payments = await tx.$queryRaw<PaymentLock[]>(Prisma.sql`
        SELECT id,installment_id,receiving_account_id,principal_transaction_id,interest_transaction_id,
          total_received,principal_received,interest_received,reversed_at
        FROM issued_loan_payments WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid AND id=${paymentId}::uuid FOR UPDATE
      `);
        const payment = payments[0];
        if (!payment) throw new NotFoundError("Cobro no encontrado");
        if (payment.reversed_at) throw new ConflictError("Cobro ya revertido");
        const loans = await tx.$queryRaw<LoanLock[]>(Prisma.sql`
        SELECT l.id,l.person_id,p.name AS person_name,l.receivable_account_id,l.currency,l.current_principal,l.status
        FROM issued_loans l JOIN financial_people p ON p.workspace_id=l.workspace_id AND p.id=l.person_id
        WHERE l.workspace_id=${workspaceId}::uuid AND l.id=${loanId}::uuid FOR UPDATE OF l
      `);
        const loan = loans[0];
        if (!loan) throw new NotFoundError("Préstamo no encontrado");
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM financial_accounts WHERE workspace_id=${workspaceId}::uuid AND id IN (${loan.receivable_account_id}::uuid,${payment.receiving_account_id}::uuid) ORDER BY id FOR UPDATE`,
        );
        const receiving = await tx.financialAccount.findFirst({
          where: { id: payment.receiving_account_id, workspaceId },
        });
        if (!receiving || receiving.currentBalance.lt(payment.total_received))
          throw new ConflictError(
            "Saldo insuficiente para revertir",
            "La cuenta receptora ya no tiene saldo suficiente para revertir este cobro de forma íntegra.",
          );
        if (payment.principal_received.gt(0))
          await tx.financialAccount.update({
            where: { id: loan.receivable_account_id },
            data: { currentBalance: { increment: payment.principal_received } },
          });
        await tx.financialAccount.update({
          where: { id: receiving.id },
          data: { currentBalance: { decrement: payment.total_received } },
        });
        const transactionIds = [
          payment.principal_transaction_id,
          payment.interest_transaction_id,
        ].filter((id): id is string => Boolean(id));
        if (transactionIds.length)
          await tx.transaction.updateMany({
            where: { workspaceId, id: { in: transactionIds }, deletedAt: null },
            data: { status: "CANCELLED", deletedAt: new Date(), updatedAt: new Date() },
          });
        await tx.$executeRaw(Prisma.sql`
        UPDATE issued_loan_installments SET principal_paid=principal_paid-${payment.principal_received},
          interest_paid=interest_paid-${payment.interest_received},total_paid=total_paid-${payment.total_received},
          paid_at=NULL,updated_at=now() WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid AND id=${payment.installment_id}::uuid
      `);
        await tx.$executeRaw(Prisma.sql`
        UPDATE issued_loans SET current_principal=current_principal+${payment.principal_received},
          principal_received=principal_received-${payment.principal_received},interest_received=interest_received-${payment.interest_received},updated_at=now()
        WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid
      `);
        await tx.$executeRaw(
          Prisma.sql`UPDATE issued_loan_payments SET reversed_at=now(),reversed_by=${userId}::uuid,reversal_reason=${reason} WHERE workspace_id=${workspaceId}::uuid AND id=${paymentId}::uuid`,
        );
        await this.refreshStatuses(tx, workspaceId, loanId);
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "ISSUED_LOAN_PAYMENT",
            entityId: paymentId,
            action: "REVERSE",
            newData: json({ reason }),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.get(workspaceId, loanId);
  }

  async archive(workspaceId: string, userId: string, loanId: string) {
    const result = await this.db.$transaction(
      async (tx) => {
        const loans = await tx.$queryRaw<
          Array<{
            current_principal: Prisma.Decimal;
            original_principal: Prisma.Decimal;
            source_account_id: string | null;
            receivable_account_id: string;
            status: string;
          }>
        >(Prisma.sql`
        SELECT current_principal,original_principal,source_account_id,receivable_account_id,status
        FROM issued_loans
        WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid AND archived_at IS NULL
        FOR UPDATE
      `);
        const loan = loans[0];
        if (!loan) throw new NotFoundError("Préstamo no encontrado");
        if (loan.current_principal.gt(0)) {
          const paymentCount = await tx.issuedLoanPayment.count({
            where: { workspaceId, loanId, reversedAt: null },
          });
          if (paymentCount)
            throw new ConflictError(
              "Préstamo con cobros registrados",
              "Revierte primero todos los cobros antes de cancelar el préstamo.",
            );
          const accountIds = [
            loan.receivable_account_id,
            ...(loan.source_account_id ? [loan.source_account_id] : []),
          ];
          await tx.$queryRaw(Prisma.sql`
          SELECT id FROM financial_accounts
          WHERE workspace_id=${workspaceId}::uuid
            AND id IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY id FOR UPDATE
        `);
          if (loan.source_account_id) {
            await tx.financialAccount.update({
              where: { id: loan.source_account_id },
              data: { currentBalance: { increment: loan.original_principal } },
            });
            await tx.transaction.updateMany({
              where: {
                workspaceId,
                destinationAccountId: loan.receivable_account_id,
                status: "CONFIRMED",
                deletedAt: null,
                metadata: { path: ["role"], equals: "DISBURSEMENT" },
              },
              data: {
                status: "CANCELLED",
                deletedAt: new Date(),
                updatedAt: new Date(),
                version: { increment: 1 },
              },
            });
          }
          await tx.financialAccount.update({
            where: { id: loan.receivable_account_id },
            data: { currentBalance: 0, isActive: false, deletedAt: new Date() },
          });
          await tx.issuedLoanPayment.deleteMany({ where: { workspaceId, loanId } });
          await tx.issuedLoan.deleteMany({ where: { workspaceId, id: loanId } });
          await tx.auditLog.create({
            data: {
              workspaceId,
              userId,
              entityType: "ISSUED_LOAN",
              entityId: loanId,
              action: "DELETE",
              newData: json({ reversedDisbursement: Boolean(loan.source_account_id) }),
            },
          });
          return { id: loanId, archived: false, mode: "REVERSED" as const };
        }
        if (loan.status !== "PAID")
          throw new ConflictError(
            "Préstamo no finalizado",
            "Solo puedes archivar un préstamo completamente pagado.",
          );
        await tx.$executeRaw(
          Prisma.sql`UPDATE issued_loans SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid`,
        );
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "ISSUED_LOAN",
            entityId: loanId,
            action: "ARCHIVE",
          },
        });
        return { id: loanId, archived: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return result;
  }
}

export const lendingService = new LendingService();
