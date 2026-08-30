import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { NotFoundError, ValidationError } from "../../common/errors/app-error.js";
import type {
  CreatePersonalBalanceInput,
  PersonalBalanceEntryInput,
  UpdatePersonalBalanceInput,
} from "./personal-balances.schemas.js";

type BalanceRow = {
  id: string;
  workspaceId: string;
  counterpartyName: string;
  direction: "PAYABLE" | "RECEIVABLE";
  originalAmount: Prisma.Decimal;
  currentBalance: Prisma.Decimal;
  currency: string;
  description: string | null;
  occurredOn: Date;
  dueOn: Date | null;
  status: "OPEN" | "PARTIAL" | "SETTLED" | "CANCELLED";
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EntryRow = {
  id: string;
  balanceId: string;
  entryType: "OPENING" | "INCREASE" | "PAYMENT" | "ADJUSTMENT";
  amount: Prisma.Decimal;
  resultingBalance: Prisma.Decimal;
  occurredAt: Date;
  notes: string | null;
  createdAt: Date;
};

const dateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const serializeEntry = (row: EntryRow) => ({
  id: row.id,
  balanceId: row.balanceId,
  type: row.entryType,
  amount: row.amount.toFixed(2),
  resultingBalance: row.resultingBalance.toFixed(2),
  occurredAt: row.occurredAt.toISOString(),
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
});
const serializeBalance = (row: BalanceRow) => ({
  id: row.id,
  counterpartyName: row.counterpartyName,
  direction: row.direction,
  originalAmount: row.originalAmount.toFixed(2),
  currentBalance: row.currentBalance.toFixed(2),
  currency: row.currency,
  description: row.description,
  occurredOn: dateOnly(row.occurredOn),
  dueOn: dateOnly(row.dueOn),
  status: row.status,
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const balanceSelect = Prisma.sql`
  SELECT
    id,
    workspace_id AS "workspaceId",
    counterparty_name AS "counterpartyName",
    direction,
    original_amount AS "originalAmount",
    current_balance AS "currentBalance",
    currency,
    description,
    occurred_on AS "occurredOn",
    due_on AS "dueOn",
    status,
    notes,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM personal_balances
`;

export class PersonalBalancesService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async findRow(workspaceId: string, id: string, tx: Prisma.TransactionClient = this.db) {
    const rows = await tx.$queryRaw<BalanceRow[]>(Prisma.sql`
      ${balanceSelect}
      WHERE workspace_id = ${workspaceId}::uuid
        AND id = ${id}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError("Saldo entre personas no encontrado");
    return row;
  }

  async list(
    workspaceId: string,
    filters: { direction?: string; status?: string; query?: string },
  ) {
    const clauses: Prisma.Sql[] = [
      Prisma.sql`workspace_id = ${workspaceId}::uuid`,
      Prisma.sql`deleted_at IS NULL`,
    ];
    if (filters.direction === "PAYABLE" || filters.direction === "RECEIVABLE") {
      clauses.push(Prisma.sql`direction = ${filters.direction}`);
    }
    if (["OPEN", "PARTIAL", "SETTLED", "CANCELLED"].includes(filters.status ?? "")) {
      clauses.push(Prisma.sql`status = ${filters.status}`);
    }
    if (filters.query?.trim()) {
      const term = `%${filters.query.trim()}%`;
      clauses.push(
        Prisma.sql`(counterparty_name ILIKE ${term} OR COALESCE(description, '') ILIKE ${term})`,
      );
    }
    const rows = await this.db.$queryRaw<BalanceRow[]>(Prisma.sql`
      ${balanceSelect}
      WHERE ${Prisma.join(clauses, " AND ")}
      ORDER BY
        CASE status WHEN 'OPEN' THEN 0 WHEN 'PARTIAL' THEN 1 WHEN 'SETTLED' THEN 2 ELSE 3 END,
        COALESCE(due_on, occurred_on) ASC,
        created_at DESC
    `);
    return rows.map(serializeBalance);
  }

  async summary(workspaceId: string) {
    type SummaryRow = {
      currency: string;
      payable: Prisma.Decimal;
      receivable: Prisma.Decimal;
      payableCount: bigint;
      receivableCount: bigint;
    };
    const rows = await this.db.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        currency,
        COALESCE(SUM(current_balance) FILTER (WHERE direction = 'PAYABLE'), 0) AS payable,
        COALESCE(SUM(current_balance) FILTER (WHERE direction = 'RECEIVABLE'), 0) AS receivable,
        COUNT(*) FILTER (WHERE direction = 'PAYABLE' AND current_balance > 0) AS "payableCount",
        COUNT(*) FILTER (WHERE direction = 'RECEIVABLE' AND current_balance > 0) AS "receivableCount"
      FROM personal_balances
      WHERE workspace_id = ${workspaceId}::uuid
        AND deleted_at IS NULL
        AND status <> 'CANCELLED'
      GROUP BY currency
      ORDER BY currency
    `);
    return {
      currencies: rows.map((row) => ({
        currency: row.currency,
        iOwe: row.payable.toFixed(2),
        owedToMe: row.receivable.toFixed(2),
        netPosition: row.receivable.minus(row.payable).toFixed(2),
        iOweCount: Number(row.payableCount),
        owedToMeCount: Number(row.receivableCount),
      })),
    };
  }

  async get(workspaceId: string, id: string) {
    const row = await this.findRow(workspaceId, id);
    const entries = await this.db.$queryRaw<EntryRow[]>(Prisma.sql`
      SELECT
        id,
        balance_id AS "balanceId",
        entry_type AS "entryType",
        amount,
        resulting_balance AS "resultingBalance",
        occurred_at AS "occurredAt",
        notes,
        created_at AS "createdAt"
      FROM personal_balance_entries
      WHERE workspace_id = ${workspaceId}::uuid
        AND balance_id = ${id}::uuid
      ORDER BY occurred_at DESC, created_at DESC
    `);
    return { ...serializeBalance(row), entries: entries.map(serializeEntry) };
  }

  async create(workspaceId: string, userId: string, input: CreatePersonalBalanceInput) {
    const amount = new Prisma.Decimal(input.amount);
    const occurredOn = input.occurredOn ?? new Date().toISOString().slice(0, 10);
    const createdId = await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO personal_balances (
          workspace_id, counterparty_name, direction, original_amount, current_balance,
          currency, description, occurred_on, due_on, notes, created_by
        ) VALUES (
          ${workspaceId}::uuid,
          ${input.counterpartyName},
          ${input.direction},
          ${amount},
          ${amount},
          ${input.currency},
          ${input.description ?? null},
          ${occurredOn}::date,
          ${input.dueOn ?? null}::date,
          ${input.notes ?? null},
          ${userId}::uuid
        )
        RETURNING id
      `);
      const id = rows[0]!.id;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO personal_balance_entries (
          workspace_id, balance_id, entry_type, amount, resulting_balance, notes, created_by
        ) VALUES (
          ${workspaceId}::uuid,
          ${id}::uuid,
          'OPENING',
          ${amount},
          ${amount},
          ${input.description ?? input.notes ?? null},
          ${userId}::uuid
        )
      `);
      return id;
    });
    return this.get(workspaceId, createdId);
  }

  async update(
    workspaceId: string,
    id: string,
    input: UpdatePersonalBalanceInput,
  ) {
    await this.findRow(workspaceId, id);
    const updates: Prisma.Sql[] = [];
    if (input.counterpartyName !== undefined) {
      updates.push(Prisma.sql`counterparty_name = ${input.counterpartyName}`);
    }
    if (input.description !== undefined) {
      updates.push(Prisma.sql`description = ${input.description}`);
    }
    if (input.dueOn !== undefined) {
      updates.push(Prisma.sql`due_on = ${input.dueOn}::date`);
    }
    if (input.notes !== undefined) updates.push(Prisma.sql`notes = ${input.notes}`);
    updates.push(Prisma.sql`updated_at = now()`);
    await this.db.$executeRaw(Prisma.sql`
      UPDATE personal_balances
      SET ${Prisma.join(updates, ", ")}
      WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid AND deleted_at IS NULL
    `);
    return this.get(workspaceId, id);
  }

  async addEntry(
    workspaceId: string,
    userId: string,
    id: string,
    input: PersonalBalanceEntryInput,
  ) {
    const amount = new Prisma.Decimal(input.amount);
    await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<BalanceRow[]>(Prisma.sql`
        ${balanceSelect}
        WHERE workspace_id = ${workspaceId}::uuid
          AND id = ${id}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `);
      const current = rows[0];
      if (!current) throw new NotFoundError("Saldo entre personas no encontrado");
      if (current.status === "CANCELLED") throw new ValidationError("Este registro está cancelado");

      let nextBalance: Prisma.Decimal;
      let nextStatus: BalanceRow["status"];
      if (input.type === "PAYMENT") {
        if (amount.gt(current.currentBalance)) {
          throw new ValidationError("El pago no puede superar el saldo pendiente");
        }
        nextBalance = current.currentBalance.minus(amount);
        nextStatus = nextBalance.eq(0) ? "SETTLED" : "PARTIAL";
      } else {
        nextBalance = current.currentBalance.plus(amount);
        nextStatus = current.status === "PARTIAL" ? "PARTIAL" : "OPEN";
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE personal_balances
        SET current_balance = ${nextBalance}, status = ${nextStatus}, updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO personal_balance_entries (
          workspace_id, balance_id, entry_type, amount, resulting_balance, occurred_at, notes, created_by
        ) VALUES (
          ${workspaceId}::uuid,
          ${id}::uuid,
          ${input.type},
          ${amount},
          ${nextBalance},
          ${input.occurredAt ? new Date(input.occurredAt) : new Date()},
          ${input.notes ?? null},
          ${userId}::uuid
        )
      `);
    });
    return this.get(workspaceId, id);
  }

  async settle(workspaceId: string, userId: string, id: string) {
    const current = await this.findRow(workspaceId, id);
    if (current.currentBalance.eq(0)) return this.get(workspaceId, id);
    return this.addEntry(workspaceId, userId, id, {
      type: "PAYMENT",
      amount: current.currentBalance.toFixed(2),
      notes: "Saldo marcado como saldado",
    });
  }

  async archive(workspaceId: string, id: string) {
    await this.findRow(workspaceId, id);
    await this.db.$executeRaw(Prisma.sql`
      UPDATE personal_balances
      SET status = 'CANCELLED', deleted_at = now(), updated_at = now()
      WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid
    `);
    return { id };
  }
}

export const personalBalancesService = new PersonalBalancesService();
