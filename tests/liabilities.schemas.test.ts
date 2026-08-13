import { describe, expect, it } from "vitest";
import {
  createDebtSchema,
  paymentSchema,
  prepaymentSchema,
} from "../src/modules/debts/debts.schemas.js";
import { createObligationSchema } from "../src/modules/obligations/obligations.schemas.js";
import { purchaseSchema, statementSchema } from "../src/modules/cards/cards.schemas.js";
describe("contratos de pasivos 9D-9M", () => {
  it("acepta crédito parcial", () =>
    expect(
      createDebtSchema.parse({
        name: "Crédito",
        type: "BANK_LOAN",
        currency: "COP",
        originalAmount: "1000000",
      }).originalAmount,
    ).toBe("1000000"));
  it("rechaza dinero flotante", () =>
    expect(() =>
      createDebtSchema.parse({
        name: "X",
        type: "BANK_LOAN",
        currency: "COP",
        originalAmount: "NaN",
      }),
    ).toThrow());
  it("exige idempotencia del pago", () => expect(() => paymentSchema.parse({})).toThrow());
  it("permite que el backend calcule el desglose del pago", () =>
    expect(
      paymentSchema.parse({
        accountId: "00000000-0000-4000-8000-000000000001",
        amount: "100.00",
        paidAt: "2026-08-12T12:00:00Z",
        idempotencyKey: "payment-auto-1",
      }).principalAmount,
    ).toBeUndefined());
  it("distingue modalidades de abono", () =>
    expect(prepaymentSchema.parse({ amount: "100", strategy: "REDUCE_TERM" }).strategy).toBe(
      "REDUCE_TERM",
    ));
  it("valida obligación variable", () =>
    expect(
      createObligationSchema.parse({
        name: "Energía",
        expectedAmount: "100",
        currency: "COP",
        amountType: "VARIABLE",
        frequency: "MONTHLY",
        startsOn: "2026-08-01",
      }).amountType,
    ).toBe("VARIABLE"));
  it("acepta compra de una cuota", () =>
    expect(
      purchaseSchema.parse({
        amount: "100",
        categoryId: "00000000-0000-4000-8000-000000000001",
        occurredAt: "2026-08-12T12:00:00Z",
        description: "Compra",
        firstDueDate: "2026-09-01",
        idempotencyKey: "purchase-1",
      }).installmentCount,
    ).toBe(1));
  it("rechaza periodo de extracto inválido en formato", () =>
    expect(() =>
      statementSchema.parse({ periodStart: "hoy", periodEnd: "2026-08-31", dueDate: "2026-09-10" }),
    ).toThrow());
});
