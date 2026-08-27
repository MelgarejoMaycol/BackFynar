import { describe, expect, it } from "vitest";
import {
  expenseSchema,
  incomeSchema,
  adjustmentSchema,
  listTransactionsSchema,
  transactionMoneySchema,
  transferSchema,
  updateTransactionSchema,
} from "../src/modules/transactions/transactions.schemas.js";
const uuid = "11111111-1111-4111-8111-111111111111";
const base = {
  accountId: uuid,
  categoryId: uuid,
  amount: "10.25",
  occurredAt: "2026-08-05T12:00:00-05:00",
};
describe("contratos de movimientos", () => {
  it.each(["0.01", "10", "9999999999999999.99"])("acepta monto %s", (v) =>
    expect(transactionMoneySchema.safeParse(v).success).toBe(true),
  );
  it.each(["0", "0.00", "-1.00", "1.234", "1e3", "NaN", "Infinity", 10])("rechaza monto %j", (v) =>
    expect(transactionMoneySchema.safeParse(v).success).toBe(false),
  );
  it("exige fecha con zona y payload estricto", () => {
    expect(expenseSchema.safeParse(base).success).toBe(true);
    expect(expenseSchema.safeParse({ ...base, occurredAt: "2026-08-05T12:00:00" }).success).toBe(
      false,
    );
    expect(expenseSchema.safeParse({ ...base, workspaceId: uuid }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, currentBalance: "1.00" }).success).toBe(false);
  });
  it("permite omitir categoría solo en el contrato de ingreso", () => {
    const withoutCategory = {
      accountId: base.accountId,
      amount: base.amount,
      occurredAt: base.occurredAt,
    };
    expect(incomeSchema.safeParse(withoutCategory).success).toBe(true);
    expect(expenseSchema.safeParse(withoutCategory).success).toBe(false);
  });
  it("rechaza transferencia a la misma cuenta", () =>
    expect(transferSchema.safeParse({ ...base, destinationAccountId: uuid }).success).toBe(false));
  it("acepta ajustes trazables sin permitir currentBalance directo", () => {
    expect(
      adjustmentSchema.safeParse({
        accountId: uuid,
        actualBalance: "-25.50",
        occurredAt: base.occurredAt,
        description: "Ajuste manual de saldo",
      }).success,
    ).toBe(true);
    expect(
      adjustmentSchema.safeParse({
        accountId: uuid,
        actualBalance: "10",
        currentBalance: "10",
        occurredAt: base.occurredAt,
      }).success,
    ).toBe(false);
  });
  it("PATCH requiere version y no permite tipo", () => {
    expect(updateTransactionSchema.safeParse({ version: 1, amount: "2.00" }).success).toBe(true);
    expect(updateTransactionSchema.safeParse({ amount: "2.00" }).success).toBe(false);
    expect(updateTransactionSchema.safeParse({ version: 1, type: "INCOME" }).success).toBe(false);
  });
  it("valida rangos y paginación", () => {
    expect(
      listTransactionsSchema.safeParse({
        minAmount: "2.50",
        maxAmount: "10.00",
        page: "2",
        limit: "100",
      }).success,
    ).toBe(true);
    expect(
      listTransactionsSchema.safeParse({ minAmount: "10.00", maxAmount: "2.50" }).success,
    ).toBe(false);
    expect(
      listTransactionsSchema.safeParse({
        dateFrom: "2026-08-06T00:00:00Z",
        dateTo: "2026-08-05T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(listTransactionsSchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
