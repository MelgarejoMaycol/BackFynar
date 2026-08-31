import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../common/errors/app-error.js";
import {
  addFrequency,
  calculateLendingSchedule,
  summarizeLendingSchedule,
} from "./lending.math.js";
import type {
  CreateLoanInput,
  PaymentInput,
  SimulationInput,
  UpdateLoanInput,
} from "./lending.schemas.js";

const d = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);
const dateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

type LoanRow = {
  id: string;
  receivable_account_id: string;
  borrower_name: string;
  currency: string;
  current_principal: Prisma.Decimal;
};

type InstallmentRow = {
  id: string;
  interest_amount: Prisma.Decimal;
  interest_paid: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  total_paid: Prisma.Decimal;
};

export class LendingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  simulate(input: SimulationInput) {
    const rows = calculateLendingSchedule({
      principal: Number(input.principal),
      ratePercent: input.ratePercent,
      termCount: input.termCount,
      method: input.method,
    });
    const summary = summarizeLendingSchedule(rows);
    const first = input.firstPaymentDate
      ? new Date(`${input.firstPaymentDate}T00:00:00Z`)
      : null;
    return {
      ...summary,
      schedule: rows.map((row, index) => ({
        ...row,
        dueDate: first ? dateOnly(addFrequency(first, input.frequency, index)) : null,
      })),
    };
  }

  async list(workspaceId: string, q?: string) {
    const term = q?.trim() ? `%${q.trim()}%` : null;
    const rows = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, borrower_name AS "borrowerName", currency,
        original_principal AS "originalPrincipal",
        current_principal AS "currentPrincipal",
        rate_percent AS "ratePercent", method, frequency,
        term_count AS "termCount", installment_amount AS "installmentAmount",
        expected_interest AS "expectedInterest", expected_total AS "expectedTotal",
        interest_received AS "interestReceived", principal_received AS "principalReceived",
        next_due_date AS "nextDueDate", estimated_end_date AS "estimatedEndDate",
        status, created_at AS "createdAt"
      FROM issued_loans
      WHERE workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL
      ${term ? Prisma.sql`AND borrower_name ILIKE ${term}` : Prisma.empty}
      ORDER BY CASE status WHEN 'OVERDUE' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,
        next_due_date ASC NULLS LAST, created_at DESC
    `);
    return rows.map((row) => ({
      ...row,
      nextDueDate: row.nextDueDate instanceof Date ? dateOnly(row.nextDueDate) : row.nextDueDate,
      estimatedEndDate:
        row.estimatedEndDate instanceof Date ? dateOnly(row.estimatedEndDate) : row.estimatedEndDate,
    }));
  }

  async summary(workspaceId: string) {
    const rows = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT currency,
        COALESCE(SUM(current_principal) FILTER (WHERE status IN ('ACTIVE','OVERDUE')),0) AS "principalPending",
        COALESCE(SUM(expected_interest - interest_received) FILTER (WHERE status IN ('ACTIVE','OVERDUE')),0) AS "interestPending",
        COALESCE(SUM(interest_received),0) AS "interestReceived",
        COUNT(*) FILTER (WHERE status IN ('ACTIVE','OVERDUE')) AS "activeCount"
      FROM issued_loans
      WHERE workspace_id=${workspaceId}::uuid AND deleted_at IS NULL
      GROUP BY currency
      ORDER BY currency
    `);
    const upcoming = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT i.loan_id AS "loanId", l.borrower_name AS "borrowerName",
        i.id AS "installmentId", i.due_date AS "dueDate",
        (i.total_amount-i.total_paid) AS amount, l.currency
      FROM issued_loan_installments i
      JOIN issued_loans l ON l.id=i.loan_id AND l.workspace_id=i.workspace_id
      WHERE i.workspace_id=${workspaceId}::uuid
        AND i.status IN ('PENDING','PARTIAL','OVERDUE')
        AND l.deleted_at IS NULL
      ORDER BY i.due_date ASC
      LIMIT 8
    `);
    return {
      currencies: rows.map((row) => ({
        ...row,
        activeCount: Number(row.activeCount ?? 0),
      })),
      upcoming: upcoming.map((row) => ({
        ...row,
        dueDate: row.dueDate instanceof Date ? dateOnly(row.dueDate) : row.dueDate,
      })),
    };
  }

  async get(workspaceId: string, loanId: string) {
    const loans = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT l.*, fa.name AS "receivableAccountName", sa.name AS "sourceAccountName"
      FROM issued_loans l
      JOIN financial_accounts fa ON fa.id=l.receivable_account_id
      LEFT JOIN financial_accounts sa ON sa.id=l.source_account_id
      WHERE l.workspace_id=${workspaceId}::uuid
        AND l.id=${loanId}::uuid
        AND l.deleted_at IS NULL
      LIMIT 1
    `);
    const loan = loans[0];
    if (!loan) throw new NotFoundError("Préstamo no encontrado");
    const installments = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate",
        opening_principal AS "openingPrincipal", principal_amount AS "principalAmount",
        interest_amount AS "interestAmount", total_amount AS "totalAmount",
        principal_paid AS "principalPaid", interest_paid AS "interestPaid",
        total_paid AS "totalPaid", closing_principal AS "closingPrincipal",
        status, paid_at AS "paidAt"
      FROM issued_loan_installments
      WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid
      ORDER BY installment_number
    `);
    const payments = await this.db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT id, installment_id AS "installmentId",
        receiving_account_id AS "receivingAccountId",
        total_received AS "totalReceived", principal_received AS "principalReceived",
        interest_received AS "interestReceived", occurred_at AS "occurredAt",
        notes, reversed_at AS "reversedAt"
      FROM issued_loan_payments
      WHERE workspace_id=${workspaceId}::uuid AND loan_id=${loanId}::uuid
      ORDER BY occurred_at DESC
    `);
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
    const principal = d(input.principal);
    const firstPayment = new Date(`${input.firstPaymentDate}T00:00:00Z`);
    const endDate = addFrequency(firstPayment, input.frequency, input.termCount - 1);

    const loanId = await this.db.$transaction(
      async (tx) => {
        const sourceAccount = input.sourceAccountId
          ? await tx.financialAccount.findFirst({
              where: {
                id: input.sourceAccountId,
                workspaceId,
                nature: "ASSET",
                isActive: true,
                deletedAt: null,
              },
            })
          : null;
        if (input.sourceAccountId && !sourceAccount)
          throw new NotFoundError("Cuenta de origen no encontrada");
        if (sourceAccount && sourceAccount.currency !== input.currency)
          throw new ValidationError(
            "La moneda del préstamo y la cuenta de origen deben coincidir",
          );
        if (sourceAccount && sourceAccount.currentBalance.lt(principal))
          throw new ConflictError(
            "Fondos insuficientes",
            "No tienes saldo suficiente para desembolsar este préstamo.",
          );

        const receivable = await tx.financialAccount.create({
          data: {
            workspaceId,
            name: `Préstamo a ${input.borrowerName}`,
            type: "LOAN",
            nature: "ASSET",
            currency: input.currency,
            openingBalance: sourceAccount ? d(0) : principal,
            currentBalance: sourceAccount ? d(0) : principal,
            includeInNetWorth: true,
            icon: "HandCoins",
          },
        });

        if (sourceAccount) {
          await tx.financialAccount.update({
            where: { id: sourceAccount.id },
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
              accountId: sourceAccount.id,
              destinationAccountId: receivable.id,
              occurredAt: new Date(`${input.disbursementDate}T12:00:00Z`),
              description: `Desembolso de préstamo a ${input.borrowerName}`,
              metadata: { lending: true, role: "DISBURSEMENT" },
            },
          });
        }

        const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO issued_loans (
            workspace_id,receivable_account_id,source_account_id,borrower_name,
            borrower_phone,borrower_document,currency,original_principal,current_principal,
            rate_percent,method,frequency,term_count,installment_amount,expected_interest,
            expected_total,disbursement_date,first_payment_date,next_due_date,
            estimated_end_date,notes,created_by
          ) VALUES (
            ${workspaceId}::uuid,${receivable.id}::uuid,${input.sourceAccountId ?? null}::uuid,
            ${input.borrowerName},${input.borrowerPhone ?? null},${input.borrowerDocument ?? null},
            ${input.currency},${principal},${principal},${input.ratePercent},${input.method},
            ${input.frequency},${input.termCount},${d(simulation.installmentAmount)},
            ${d(simulation.totalInterest)},${d(simulation.totalReceivable)},
            ${input.disbursementDate}::date,${input.firstPaymentDate}::date,
            ${input.firstPaymentDate}::date,${dateOnly(endDate)}::date,${input.notes ?? null},
            ${userId}::uuid
          ) RETURNING id
        `);
        const createdLoanId = ids[0]?.id;
        if (!createdLoanId) throw new Error("No se pudo crear el préstamo");

        for (const row of simulation.schedule) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO issued_loan_installments (
              workspace_id,loan_id,installment_number,due_date,opening_principal,
              principal_amount,interest_amount,total_amount,closing_principal
            ) VALUES (
              ${workspaceId}::uuid,${createdLoanId}::uuid,${row.installmentNumber},
              ${row.dueDate}::date,${d(row.openingPrincipal)},${d(row.principalAmount)},
              ${d(row.interestAmount)},${d(row.totalAmount)},${d(row.closingPrincipal)}
            )
          `);
        }
        return createdLoanId;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.get(workspaceId, loanId);
  }

  async update(workspaceId: string, loanId: string, input: UpdateLoanInput) {
    const changes: Prisma.Sql[] = [];
    if (input.borrowerName !== undefined)
      changes.push(Prisma.sql`borrower_name=${input.borrowerName}`);
    if (input.borrowerPhone !== undefined)
      changes.push(Prisma.sql`borrower_phone=${input.borrowerPhone}`);
    if (input.borrowerDocument !== undefined)
      changes.push(Prisma.sql`borrower_document=${input.borrowerDocument}`);
    if (input.notes !== undefined) changes.push(Prisma.sql`notes=${input.notes}`);
    if (!changes.length) return this.get(workspaceId, loanId);
    const changed = await this.db.$executeRaw(Prisma.sql`
      UPDATE issued_loans
      SET ${Prisma.join(changes, ",")}, updated_at=now()
      WHERE workspace_id=${workspaceId}::uuid
        AND id=${loanId}::uuid
        AND deleted_at IS NULL
    `);
    if (!changed) throw new NotFoundError("Préstamo no encontrado");
    return this.get(workspaceId, loanId);
  }

  async pay(
    workspaceId: string,
    userId: string,
    loanId: string,
    installmentId: string,
    input: PaymentInput,
  ) {
    const amount = d(input.amount);
    let idempotent = false;

    await this.db.$transaction(
      async (tx) => {
        const existing = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM issued_loan_payments
          WHERE workspace_id=${workspaceId}::uuid
            AND idempotency_key=${input.idempotencyKey}
          LIMIT 1
        `);
        if (existing[0]) {
          idempotent = true;
          return;
        }

        const loans = await tx.$queryRaw<LoanRow[]>(Prisma.sql`
          SELECT id, receivable_account_id, borrower_name, currency, current_principal
          FROM issued_loans
          WHERE workspace_id=${workspaceId}::uuid
            AND id=${loanId}::uuid
            AND deleted_at IS NULL
          FOR UPDATE
        `);
        const loan = loans[0];
        if (!loan) throw new NotFoundError("Préstamo no encontrado");

        const installments = await tx.$queryRaw<InstallmentRow[]>(Prisma.sql`
          SELECT id, interest_amount, interest_paid, total_amount, total_paid
          FROM issued_loan_installments
          WHERE workspace_id=${workspaceId}::uuid
            AND loan_id=${loanId}::uuid
            AND id=${installmentId}::uuid
          FOR UPDATE
        `);
        const installment = installments[0];
        if (!installment) throw new NotFoundError("Cuota no encontrada");

        const account = await tx.financialAccount.findFirst({
          where: {
            id: input.receivingAccountId,
            workspaceId,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
          },
        });
        if (!account) throw new NotFoundError("Cuenta receptora no encontrada");
        if (account.currency !== loan.currency)
          throw new ValidationError("La moneda de la cuenta receptora no coincide");

        const remainingTotal = Prisma.Decimal.max(
          0,
          d(installment.total_amount).minus(d(installment.total_paid)),
        );
        if (amount.gt(remainingTotal))
          throw new ConflictError(
            "Cobro superior a la cuota pendiente",
            "El cobro no puede superar el saldo pendiente de esta cuota.",
          );

        const remainingInterest = Prisma.Decimal.max(
          0,
          d(installment.interest_amount).minus(d(installment.interest_paid)),
        );
        const interestPart = Prisma.Decimal.min(amount, remainingInterest);
        const principalPart = Prisma.Decimal.min(
          d(loan.current_principal),
          amount.minus(interestPart),
        );
        const applied = principalPart.plus(interestPart);
        if (applied.lte(0))
          throw new ValidationError("No hay saldo pendiente para aplicar el cobro");
        if (!applied.eq(amount))
          throw new ConflictError(
            "Cobro superior al saldo aplicable",
            "El monto supera el capital e interés pendientes de esta cuota.",
          );

        let principalTransactionId: string | null = null;
        let interestTransactionId: string | null = null;
        const occurredAt = new Date(input.occurredAt ?? new Date().toISOString());

        if (principalPart.gt(0)) {
          const receivable = await tx.financialAccount.findFirst({
            where: { id: loan.receivable_account_id, workspaceId },
          });
          if (!receivable || receivable.currentBalance.lt(principalPart))
            throw new ConflictError(
              "Saldo inconsistente",
              "El saldo por cobrar no permite aplicar este pago.",
            );
          await tx.financialAccount.update({
            where: { id: receivable.id },
            data: { currentBalance: { decrement: principalPart } },
          });
          await tx.financialAccount.update({
            where: { id: account.id },
            data: { currentBalance: { increment: principalPart } },
          });
          const transaction = await tx.transaction.create({
            data: {
              workspaceId,
              createdBy: userId,
              type: "TRANSFER",
              status: "CONFIRMED",
              amount: principalPart,
              currency: loan.currency,
              accountId: receivable.id,
              destinationAccountId: account.id,
              occurredAt,
              description: `Recuperación de capital · ${loan.borrower_name}`,
              metadata: { lending: true, loanId, role: "PRINCIPAL_COLLECTION" },
            },
          });
          principalTransactionId = transaction.id;
        }

        if (interestPart.gt(0)) {
          await tx.financialAccount.update({
            where: { id: account.id },
            data: { currentBalance: { increment: interestPart } },
          });
          const transaction = await tx.transaction.create({
            data: {
              workspaceId,
              createdBy: userId,
              type: "INCOME",
              status: "CONFIRMED",
              amount: interestPart,
              currency: loan.currency,
              accountId: account.id,
              occurredAt,
              description: `Interés recibido · ${loan.borrower_name}`,
              notes: input.notes ?? undefined,
              metadata: { lending: true, loanId, role: "INTEREST_INCOME" },
            },
          });
          interestTransactionId = transaction.id;
        }

        const nextPrincipal = Prisma.Decimal.max(
          0,
          d(loan.current_principal).minus(principalPart),
        );
        const totalPaid = d(installment.total_paid).plus(amount);
        const expectedTotal = d(installment.total_amount);
        const installmentStatus = totalPaid.gte(expectedTotal) ? "PAID" : "PARTIAL";

        await tx.$executeRaw(Prisma.sql`
          UPDATE issued_loan_installments
          SET principal_paid=principal_paid+${principalPart},
            interest_paid=interest_paid+${interestPart},
            total_paid=total_paid+${amount},
            status=${installmentStatus},
            paid_at=${installmentStatus === "PAID" ? occurredAt : null},
            updated_at=now()
          WHERE workspace_id=${workspaceId}::uuid
            AND loan_id=${loanId}::uuid
            AND id=${installmentId}::uuid
        `);

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO issued_loan_payments (
            workspace_id,loan_id,installment_id,receiving_account_id,
            principal_transaction_id,interest_transaction_id,total_received,
            principal_received,interest_received,occurred_at,notes,idempotency_key,created_by
          ) VALUES (
            ${workspaceId}::uuid,${loanId}::uuid,${installmentId}::uuid,${account.id}::uuid,
            ${principalTransactionId}::uuid,${interestTransactionId}::uuid,${amount},
            ${principalPart},${interestPart},${occurredAt},${input.notes ?? null},
            ${input.idempotencyKey},${userId}::uuid
          )
        `);

        const pending = await tx.$queryRaw<Array<{ due_date: Date }>>(Prisma.sql`
          SELECT due_date FROM issued_loan_installments
          WHERE workspace_id=${workspaceId}::uuid
            AND loan_id=${loanId}::uuid
            AND status IN ('PENDING','PARTIAL','OVERDUE')
          ORDER BY due_date
          LIMIT 1
        `);

        await tx.$executeRaw(Prisma.sql`
          UPDATE issued_loans
          SET current_principal=${nextPrincipal},
            principal_received=principal_received+${principalPart},
            interest_received=interest_received+${interestPart},
            next_due_date=${pending[0]?.due_date ?? null},
            status=${nextPrincipal.eq(0) ? "PAID" : "ACTIVE"},
            updated_at=now()
          WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid
        `);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const result = await this.get(workspaceId, loanId);
    return { ...result, idempotent };
  }

  async archive(workspaceId: string, loanId: string) {
    const rows = await this.db.$queryRaw<Array<{ current_principal: Prisma.Decimal }>>(
      Prisma.sql`
        SELECT current_principal FROM issued_loans
        WHERE workspace_id=${workspaceId}::uuid
          AND id=${loanId}::uuid
          AND deleted_at IS NULL
      `,
    );
    if (!rows[0]) throw new NotFoundError("Préstamo no encontrado");
    if (d(rows[0].current_principal).gt(0))
      throw new ConflictError(
        "Préstamo con saldo pendiente",
        "Solo puedes archivar un préstamo cuando su capital pendiente sea cero.",
      );
    await this.db.$executeRaw(Prisma.sql`
      UPDATE issued_loans
      SET status='CANCELLED',deleted_at=now(),updated_at=now()
      WHERE workspace_id=${workspaceId}::uuid AND id=${loanId}::uuid
    `);
    return { id: loanId };
  }
}

export const lendingService = new LendingService();
