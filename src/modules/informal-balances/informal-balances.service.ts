import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import type {
  CreateInformalBalanceInput,
  InformalPaymentInput,
  ListInformalBalancesInput,
  UpdateInformalBalanceInput,
} from "./informal-balances.schemas.js";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Direction = "PAYABLE" | "RECEIVABLE";
type Status = "OPEN" | "PARTIAL" | "SETTLED" | "CANCELLED";

type BalanceRow = {
  id: string;
  workspace_id: string;
  direction: Direction;
  counterparty_name: string;
  description: string;
  original_amount: Prisma.Decimal;
  current_balance: Prisma.Decimal;
  currency: string;
  occurred_on: Date;
  due_on: Date | null;
  status: Status;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

type PaymentRow = {
  id: string;
  amount: Prisma.Decimal;
  paid_at: Date;
  account_id: string | null;
  transaction_id: string | null;
  notes: string | null;
  reversed_at: Date | null;
};

const missing = () => new NotFoundError("Pendiente entre personas no encontrado");
const D = (v: string | Prisma.Decimal) => new Prisma.Decimal(v);
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const publicBalance = (r: BalanceRow) => ({
  id: r.id,
  direction: r.direction,
  counterpartyName: r.counterparty_name,
  description: r.description,
  originalAmount: r.original_amount.toFixed(2),
  currentBalance: r.current_balance.toFixed(2),
  paidAmount: r.original_amount.minus(r.current_balance).toFixed(2),
  currency: r.currency.trim(),
  occurredOn: dateOnly(r.occurred_on),
  dueOn: dateOnly(r.due_on),
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const publicPayment = (r: PaymentRow) => ({
  id: r.id,
  amount: r.amount.toFixed(2),
  paidAt: r.paid_at.toISOString(),
  accountId: r.account_id,
  transactionId: r.transaction_id,
  notes: r.notes,
  reversedAt: r.reversed_at?.toISOString() ?? null,
});

async function findOne(db: Db | Tx, workspaceId: string, id: string, lock = false) {
  const suffix = lock ? Prisma.sql` FOR UPDATE` : Prisma.empty;
  const rows = await db.$queryRaw<BalanceRow[]>(Prisma.sql`
    SELECT id, workspace_id, direction, counterparty_name, description,
           original_amount, current_balance, currency, occurred_on, due_on,
           status, notes, created_at, updated_at
      FROM informal_balances
     WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL${suffix}
  `);
  return rows[0] ?? null;
}

export class InformalBalancesService {
  constructor(private readonly db: Db = prisma) {}

  async list(workspaceId: string, filters: ListInformalBalancesInput) {
    const search = filters.search ? `%${filters.search}%` : null;
    const rows = await this.db.$queryRaw<BalanceRow[]>(Prisma.sql`
      SELECT id, workspace_id, direction, counterparty_name, description,
             original_amount, current_balance, currency, occurred_on, due_on,
             status, notes, created_at, updated_at
        FROM informal_balances
       WHERE workspace_id = ${workspaceId}::uuid
         AND deleted_at IS NULL
         AND (${filters.direction ?? null}::text IS NULL OR direction = ${filters.direction ?? null})
         AND (${filters.status ?? null}::text IS NULL OR status = ${filters.status ?? null})
         AND (${search}::text IS NULL OR counterparty_name ILIKE ${search} OR description ILIKE ${search})
       ORDER BY CASE WHEN status IN ('OPEN','PARTIAL') THEN 0 ELSE 1 END,
                due_on ASC NULLS LAST, created_at DESC
    `);
    return rows.map(publicBalance);
  }

  async summary(workspaceId: string) {
    const rows = await this.db.$queryRaw<{
      currency: string;
      payable: Prisma.Decimal;
      receivable: Prisma.Decimal;
      overdue_count: bigint;
    }[]>(Prisma.sql`
      SELECT currency,
             COALESCE(SUM(current_balance) FILTER (WHERE direction = 'PAYABLE' AND status IN ('OPEN','PARTIAL')), 0) AS payable,
             COALESCE(SUM(current_balance) FILTER (WHERE direction = 'RECEIVABLE' AND status IN ('OPEN','PARTIAL')), 0) AS receivable,
             COUNT(*) FILTER (WHERE status IN ('OPEN','PARTIAL') AND due_on < CURRENT_DATE) AS overdue_count
        FROM informal_balances
       WHERE workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL
       GROUP BY currency ORDER BY currency
    `);
    return rows.map((r) => ({
      currency: r.currency.trim(),
      totalPayable: r.payable.toFixed(2),
      totalReceivable: r.receivable.toFixed(2),
      net: r.receivable.minus(r.payable).toFixed(2),
      overdueCount: Number(r.overdue_count),
    }));
  }

  async get(workspaceId: string, id: string) {
    const row = await findOne(this.db, workspaceId, id);
    if (!row) throw missing();
    const payments = await this.db.$queryRaw<PaymentRow[]>(Prisma.sql`
      SELECT id, amount, paid_at, account_id, transaction_id, notes, reversed_at
        FROM informal_balance_payments
       WHERE workspace_id = ${workspaceId}::uuid AND informal_balance_id = ${id}::uuid
       ORDER BY paid_at DESC, created_at DESC
    `);
    return { ...publicBalance(row), payments: payments.map(publicPayment) };
  }

  async create(workspaceId: string, userId: string, input: CreateInformalBalanceInput) {
    const amount = D(input.amount);
    const rows = await this.db.$queryRaw<BalanceRow[]>(Prisma.sql`
      INSERT INTO informal_balances
        (workspace_id, direction, counterparty_name, description, original_amount,
         current_balance, currency, occurred_on, due_on, notes, created_by)
      VALUES (${workspaceId}::uuid, ${input.direction}, ${input.counterpartyName}, ${input.description},
              ${amount}, ${amount}, ${input.currency}, ${input.occurredOn}::date,
              ${input.dueOn ?? null}::date, ${input.notes ?? null}, ${userId}::uuid)
      RETURNING id, workspace_id, direction, counterparty_name, description,
                original_amount, current_balance, currency, occurred_on, due_on,
                status, notes, created_at, updated_at
    `);
    const row = rows[0]!;
    await this.db.auditLog.create({ data: { workspaceId, userId, entityType: "INFORMAL_BALANCE", entityId: row.id, action: "CREATE", newData: { direction: input.direction, amount: input.amount, counterpartyName: input.counterpartyName } } });
    return publicBalance(row);
  }

  async update(workspaceId: string, userId: string, id: string, input: UpdateInformalBalanceInput) {
    const row = await findOne(this.db, workspaceId, id);
    if (!row) throw missing();
    if (row.status === "CANCELLED") throw new ConflictError("No se puede editar un pendiente archivado");
    const rows = await this.db.$queryRaw<BalanceRow[]>(Prisma.sql`
      UPDATE informal_balances SET
        counterparty_name = COALESCE(${input.counterpartyName ?? null}, counterparty_name),
        description = COALESCE(${input.description ?? null}, description),
        due_on = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "dueOn")} THEN ${input.dueOn ?? null}::date ELSE due_on END,
        notes = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "notes")} THEN ${input.notes ?? null} ELSE notes END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL
      RETURNING id, workspace_id, direction, counterparty_name, description,
                original_amount, current_balance, currency, occurred_on, due_on,
                status, notes, created_at, updated_at
    `);
    await this.db.auditLog.create({ data: { workspaceId, userId, entityType: "INFORMAL_BALANCE", entityId: id, action: "UPDATE", oldData: { counterpartyName: row.counterparty_name, description: row.description }, newData: input } });
    return publicBalance(rows[0]!);
  }

  async archive(workspaceId: string, userId: string, id: string) {
    const row = await findOne(this.db, workspaceId, id);
    if (!row) throw missing();
    await this.db.$executeRaw(Prisma.sql`
      UPDATE informal_balances SET status = 'CANCELLED', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
    `);
    await this.db.auditLog.create({ data: { workspaceId, userId, entityType: "INFORMAL_BALANCE", entityId: id, action: "ARCHIVE", oldData: { status: row.status, currentBalance: row.current_balance.toFixed(2) } } });
    return { mode: "LOGICAL" as const };
  }

  async pay(workspaceId: string, userId: string, id: string, input: InformalPaymentInput) {
    return withTransactionRetry(this.db, async (tx) => {
      const existing = await tx.$queryRaw<PaymentRow[]>(Prisma.sql`
        SELECT id, amount, paid_at, account_id, transaction_id, notes, reversed_at
          FROM informal_balance_payments
         WHERE workspace_id = ${workspaceId}::uuid AND idempotency_key = ${input.idempotencyKey}
         LIMIT 1
      `);
      if (existing[0]) return { ...publicPayment(existing[0]), idempotent: true };

      const balance = await findOne(tx, workspaceId, id, true);
      if (!balance) throw missing();
      if (!["OPEN", "PARTIAL"].includes(balance.status)) throw new ConflictError("Este pendiente ya no admite pagos");
      const amount = D(input.amount);
      if (amount.gt(balance.current_balance)) throw new ConflictError("El pago no puede superar el saldo pendiente");

      let transactionId: string | null = null;
      if (input.accountId) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM financial_accounts WHERE id = ${input.accountId}::uuid AND workspace_id = ${workspaceId}::uuid FOR UPDATE`);
        const account = await tx.financialAccount.findFirst({ where: { id: input.accountId, workspaceId, isActive: true, deletedAt: null } });
        if (!account || account.nature !== "ASSET") throw new ConflictError("Selecciona una cuenta de dinero activa");
        if (account.currency.trim() !== balance.currency.trim()) throw new ConflictError("La cuenta y el pendiente deben usar la misma moneda");
        if (balance.direction === "PAYABLE" && account.currentBalance.lt(amount)) throw new ConflictError("La cuenta seleccionada no tiene fondos suficientes");

        const transaction = await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type: balance.direction === "PAYABLE" ? "DEBT_PAYMENT" : "REFUND",
            status: "CONFIRMED",
            amount,
            currency: balance.currency.trim(),
            accountId: account.id,
            occurredAt: new Date(input.paidAt),
            description: balance.direction === "PAYABLE" ? `Pago a ${balance.counterparty_name}: ${balance.description}` : `Cobro a ${balance.counterparty_name}: ${balance.description}`,
            externalReference: input.idempotencyKey,
            metadata: {
              source: "INFORMAL_BALANCE",
              informalBalanceId: balance.id,
              direction: balance.direction,
              counterpartyName: balance.counterparty_name,
              operation: balance.direction === "PAYABLE" ? "PERSON_TO_PERSON_PAYMENT" : "PERSON_TO_PERSON_COLLECTION",
            },
          },
        });
        transactionId = transaction.id;
        await tx.financialAccount.update({ where: { id: account.id }, data: { currentBalance: balance.direction === "PAYABLE" ? { decrement: amount } : { increment: amount } } });
      }

      const remaining = balance.current_balance.minus(amount);
      const status: Status = remaining.isZero() ? "SETTLED" : "PARTIAL";
      await tx.$executeRaw(Prisma.sql`
        UPDATE informal_balances SET current_balance = ${remaining}, status = ${status}, updated_at = CURRENT_TIMESTAMP
         WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
      `);
      const payments = await tx.$queryRaw<PaymentRow[]>(Prisma.sql`
        INSERT INTO informal_balance_payments
          (workspace_id, informal_balance_id, transaction_id, account_id, amount, paid_at, notes, idempotency_key, created_by)
        VALUES (${workspaceId}::uuid, ${id}::uuid, ${transactionId}::uuid, ${input.accountId ?? null}::uuid,
                ${amount}, ${input.paidAt}::timestamptz, ${input.notes ?? null}, ${input.idempotencyKey}, ${userId}::uuid)
        RETURNING id, amount, paid_at, account_id, transaction_id, notes, reversed_at
      `);
      await tx.auditLog.create({ data: { workspaceId, userId, entityType: "INFORMAL_BALANCE", entityId: id, action: balance.direction === "PAYABLE" ? "PAY" : "COLLECT", newData: { amount: input.amount, remaining: remaining.toFixed(2), accountId: input.accountId ?? null } } });
      return { ...publicPayment(payments[0]!), remainingBalance: remaining.toFixed(2), status, idempotent: false };
    });
  }
}

export const informalBalancesService = new InformalBalancesService();
