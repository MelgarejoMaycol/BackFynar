import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors/app-error.js";
import { balanceDeltas, assertSufficientTransferFunds } from "../transactions/transactions.service.js";
import type {
  CreatePersonalBalanceInput,
  PersonalBalanceEntryInput,
  UpdatePersonalBalanceInput,
  CreatePersonInput,
  UpdatePersonInput,
} from "./personal-balances.schemas.js";

type BalanceRow = {
  id: string;
  workspaceId: string;
  counterpartyName: string;
  personId: string;
  relationship: string | null;
  direction: "PAYABLE" | "RECEIVABLE";
  originalAmount: Prisma.Decimal;
  currentBalance: Prisma.Decimal;
  currency: string;
  description: string | null;
  occurredOn: Date;
  dueOn: Date | null;
  status: "OPEN" | "PARTIAL" | "SETTLED" | "CANCELLED";
  settledAt: Date | null;
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
  accountId: string | null;
  accountName: string | null;
  transactionId: string | null;
  reversedAt: Date | null;
};

const dateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const financialStatus = (
  pending: Prisma.Decimal,
  paid: Prisma.Decimal,
): BalanceRow["status"] => (pending.lte(0) ? "SETTLED" : paid.gt(0) ? "PARTIAL" : "OPEN");
const serializeEntry = (row: EntryRow) => ({
  id: row.id,
  balanceId: row.balanceId,
  type: row.entryType,
  amount: row.amount.toFixed(2),
  resultingBalance: row.resultingBalance.toFixed(2),
  occurredAt: row.occurredAt.toISOString(),
  notes: row.notes,
  accountId: row.accountId,
  accountName: row.accountName,
  transactionId: row.transactionId,
  reversedAt: row.reversedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
const serializeBalance = (row: BalanceRow) => ({
  id: row.id,
  personId: row.personId,
  person: { id: row.personId, name: row.counterpartyName, relationship: row.relationship },
  counterpartyName: row.counterpartyName,
  direction: row.direction,
  originalAmount: row.originalAmount.toFixed(2),
  currentBalance: row.currentBalance.toFixed(2),
  currency: row.currency,
  description: row.description,
  occurredOn: dateOnly(row.occurredOn),
  dueOn: dateOnly(row.dueOn),
  status: row.status,
  settledAt: row.settledAt?.toISOString() ?? null,
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const balanceSelect = Prisma.sql`
  SELECT
    id,
    workspace_id AS "workspaceId",
    counterparty_name AS "counterpartyName",
    person_id AS "personId",
    (SELECT relationship FROM financial_people fp WHERE fp.id = personal_balances.person_id) AS relationship,
    direction,
    original_amount AS "originalAmount",
    current_balance AS "currentBalance",
    currency,
    description,
    occurred_on AS "occurredOn",
    due_on AS "dueOn",
    status,
    settled_at AS "settledAt",
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
    } else {
      clauses.push(Prisma.sql`status IN ('OPEN', 'PARTIAL') AND current_balance > 0`);
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
        entry.id,
        entry.balance_id AS "balanceId",
        entry.entry_type AS "entryType",
        entry.amount,
        entry.resulting_balance AS "resultingBalance",
        entry.occurred_at AS "occurredAt",
        entry.notes,
        entry.created_at AS "createdAt",
        entry.account_id AS "accountId",
        account.name AS "accountName",
        entry.transaction_id AS "transactionId",
        entry.reversed_at AS "reversedAt"
      FROM personal_balance_entries entry
      LEFT JOIN financial_accounts account ON account.id = entry.account_id
      WHERE entry.workspace_id = ${workspaceId}::uuid
        AND entry.balance_id = ${id}::uuid
      ORDER BY entry.occurred_at DESC, entry.created_at DESC
    `);
    return { ...serializeBalance(row), entries: entries.map(serializeEntry) };
  }

  async create(workspaceId: string, userId: string, input: CreatePersonalBalanceInput) {
    const amount = new Prisma.Decimal(input.amount);
    const occurredOn = input.occurredOn ?? new Date().toISOString().slice(0, 10);
    const createdId = await this.db.$transaction(async (tx) => {
      const person = await tx.financialPerson.findFirst({
        where: { id: input.personId, workspaceId, isActive: true, archivedAt: null },
      });
      if (!person) throw new NotFoundError("Persona no encontrada");
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO personal_balances (
          workspace_id, person_id, counterparty_name, direction, original_amount, current_balance,
          currency, description, occurred_on, due_on, notes, created_by
        ) VALUES (
          ${workspaceId}::uuid,
          ${person.id}::uuid,
          ${person.name},
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
    const current = await this.findRow(workspaceId, id);
    const updates: Prisma.Sql[] = [];
    if (input.personId !== undefined) {
      const person = await this.db.financialPerson.findFirst({
        where: { id: input.personId, workspaceId, isActive: true, archivedAt: null },
      });
      if (!person) throw new NotFoundError("Persona no encontrada");
      updates.push(Prisma.sql`person_id = ${person.id}::uuid`);
      updates.push(Prisma.sql`counterparty_name = ${person.name}`);
    }
    if (input.originalAmount !== undefined) {
      const paid = current.originalAmount.minus(current.currentBalance);
      const original = new Prisma.Decimal(input.originalAmount);
      if (original.lt(paid)) {
        throw new ValidationError("El monto original no puede ser menor que lo ya pagado o cobrado");
      }
      updates.push(Prisma.sql`original_amount = ${original}`);
      updates.push(Prisma.sql`current_balance = ${original.minus(paid)}`);
      const status = financialStatus(original.minus(paid), paid);
      updates.push(Prisma.sql`status = ${status}`);
      updates.push(Prisma.sql`settled_at = ${status === "SETTLED" ? new Date() : null}`);
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
        nextStatus = financialStatus(nextBalance, current.originalAmount.minus(nextBalance));
      } else {
        nextBalance = current.currentBalance.plus(amount);
        const nextOriginal = current.originalAmount.plus(amount);
        nextStatus = financialStatus(nextBalance, nextOriginal.minus(nextBalance));
      }

      let accountId: string | null = null;
      let transactionId: string | null = null;
      if (input.type === "PAYMENT") {
        accountId = input.accountId;
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM financial_accounts
          WHERE workspace_id = ${workspaceId}::uuid AND id = ${accountId}::uuid
          FOR UPDATE
        `);
        const account = await tx.financialAccount.findFirst({
          where: { id: accountId, workspaceId, nature: "ASSET", isActive: true, deletedAt: null },
        });
        if (!account) throw new NotFoundError("Cuenta activa no encontrada");
        if (account.currency !== current.currency) {
          throw new ConflictError("Monedas incompatibles", "La cuenta y la deuda deben usar la misma moneda");
        }
        const transactionType = current.direction === "PAYABLE" ? "EXPENSE" : "INCOME";
        if (transactionType === "EXPENSE") assertSufficientTransferFunds(amount, account.currentBalance);
        const { sourceDelta } = balanceDeltas(transactionType, amount, account.nature);
        await tx.financialAccount.update({
          where: { id: account.id },
          data: { currentBalance: { increment: sourceDelta } },
        });
        const transaction = await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type: transactionType,
            status: "CONFIRMED",
            amount,
            currency: current.currency,
            accountId,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
            description: `${transactionType === "EXPENSE" ? "Pago de deuda" : "Cobro recibido"} · ${current.counterpartyName}`,
            notes: input.notes ?? null,
            metadata: { source: "PERSONAL_BALANCE", personalBalanceId: id },
          },
        });
        transactionId = transaction.id;
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE personal_balances
        SET current_balance = ${nextBalance},
            original_amount = CASE WHEN ${input.type} = 'INCREASE' THEN original_amount + ${amount} ELSE original_amount END,
            status = ${nextStatus},
            settled_at = ${nextStatus === "SETTLED" ? (input.occurredAt ? new Date(input.occurredAt) : new Date()) : null},
            updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO personal_balance_entries (
          workspace_id, balance_id, entry_type, amount, resulting_balance, account_id,
          transaction_id, occurred_at, notes, created_by
        ) VALUES (
          ${workspaceId}::uuid,
          ${id}::uuid,
          ${input.type},
          ${amount},
          ${nextBalance},
          ${accountId}::uuid,
          ${transactionId}::uuid,
          ${input.occurredAt ? new Date(input.occurredAt) : new Date()},
          ${input.notes ?? null},
          ${userId}::uuid
        )
      `);
    });
    return this.get(workspaceId, id);
  }

  async settle(workspaceId: string, userId: string, id: string, accountId: string) {
    const current = await this.findRow(workspaceId, id);
    if (current.currentBalance.eq(0)) return this.get(workspaceId, id);
    return this.addEntry(workspaceId, userId, id, {
      type: "PAYMENT",
      amount: current.currentBalance.toFixed(2),
      accountId,
      notes: "Saldo marcado como saldado",
    });
  }

  async reverseEntry(workspaceId: string, userId: string, id: string, entryId: string) {
    await this.db.$transaction(async (tx) => {
      const balances = await tx.$queryRaw<BalanceRow[]>(Prisma.sql`
        ${balanceSelect}
        WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `);
      const balance = balances[0];
      if (!balance) throw new NotFoundError("Saldo entre personas no encontrado");
      const entries = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
        SELECT entry.id, entry.balance_id AS "balanceId", entry.entry_type AS "entryType",
          entry.amount, entry.resulting_balance AS "resultingBalance", entry.occurred_at AS "occurredAt",
          entry.notes, entry.created_at AS "createdAt", entry.account_id AS "accountId",
          account.name AS "accountName", entry.transaction_id AS "transactionId", entry.reversed_at AS "reversedAt"
        FROM personal_balance_entries entry
        LEFT JOIN financial_accounts account ON account.id = entry.account_id
        WHERE entry.workspace_id = ${workspaceId}::uuid AND entry.balance_id = ${id}::uuid
          AND entry.id = ${entryId}::uuid
        FOR UPDATE OF entry
      `);
      const entry = entries[0];
      if (!entry || entry.entryType !== "PAYMENT") throw new NotFoundError("Pago o cobro no encontrado");
      if (entry.reversedAt) return;
      if (!entry.accountId || !entry.transactionId) {
        throw new ConflictError("Operación legacy", "Este registro histórico no tiene una transacción financiera reversible.");
      }
      await tx.$queryRaw(Prisma.sql`SELECT id FROM financial_accounts WHERE id = ${entry.accountId}::uuid FOR UPDATE`);
      const transaction = await tx.transaction.findFirst({
        where: { id: entry.transactionId, workspaceId, status: "CONFIRMED", deletedAt: null },
      });
      const account = await tx.financialAccount.findFirst({ where: { id: entry.accountId, workspaceId } });
      if (!transaction || !account) throw new ConflictError("Operación financiera no disponible");
      const { sourceDelta } = balanceDeltas(
        transaction.type === "EXPENSE" ? "EXPENSE" : "INCOME",
        transaction.amount.negated(),
        account.nature,
      );
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: sourceDelta } },
      });
      const restored = balance.currentBalance.plus(entry.amount);
      const paid = balance.originalAmount.minus(restored);
      await tx.$executeRaw(Prisma.sql`
        UPDATE personal_balances SET current_balance = ${restored},
          status = ${financialStatus(restored, paid)}, settled_at = NULL, updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE personal_balance_entries SET reversed_at = now(), updated_at = now()
        WHERE workspace_id = ${workspaceId}::uuid AND id = ${entryId}::uuid
      `);
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { status: "CANCELLED", deletedAt: new Date(), version: { increment: 1 } },
      });
      await tx.auditLog.create({ data: {
        workspaceId, userId, entityType: "PERSONAL_BALANCE_ENTRY", entityId: entryId,
        action: "REVERSE", oldData: { transactionId: transaction.id, amount: entry.amount.toFixed(2) },
      } });
    });
    return this.get(workspaceId, id);
  }

  listPeople(workspaceId: string, query?: string) {
    return this.db.financialPerson.findMany({
      where: { workspaceId, isActive: true, archivedAt: null,
        ...(query?.trim() ? { name: { contains: query.trim(), mode: "insensitive" } } : {}) },
      orderBy: { name: "asc" },
    });
  }

  createPerson(workspaceId: string, userId: string, input: CreatePersonInput) {
    return this.db.financialPerson.create({ data: {
      workspaceId, createdBy: userId, name: input.name,
      relationship: input.relationship ?? null, notes: input.notes ?? null,
    } });
  }

  async updatePerson(workspaceId: string, id: string, input: UpdatePersonInput) {
    const person = await this.db.financialPerson.findFirst({ where: { id, workspaceId, isActive: true } });
    if (!person) throw new NotFoundError("Persona no encontrada");
    return this.db.$transaction(async (tx) => {
      const updated = await tx.financialPerson.update({ where: { id }, data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.relationship !== undefined ? { relationship: input.relationship } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      } });
      if (input.name !== undefined) await tx.personalBalance.updateMany({
        where: { workspaceId, personId: id }, data: { counterpartyName: input.name },
      });
      return updated;
    });
  }

  async archivePerson(workspaceId: string, id: string) {
    const active = await this.db.personalBalance.count({
      where: { workspaceId, personId: id, deletedAt: null, status: { in: ["OPEN", "PARTIAL"] } },
    });
    if (active) throw new ConflictError("Persona con saldos activos", "Primero salda o archiva sus deudas y cobros.");
    const result = await this.db.financialPerson.updateMany({
      where: { id, workspaceId, isActive: true },
      data: { isActive: false, archivedAt: new Date(), updatedAt: new Date() },
    });
    if (!result.count) throw new NotFoundError("Persona no encontrada");
    return { id };
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
