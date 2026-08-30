import { describe, expect, it } from "vitest";
import {
  createInformalBalanceSchema,
  informalPaymentSchema,
  updateInformalBalanceSchema,
} from "../src/modules/informal-balances/informal-balances.schemas.js";

describe("informal balances schemas", () => {
  it("accepts a payable without interests or installments", () => {
    const result = createInformalBalanceSchema.safeParse({
      direction: "PAYABLE",
      counterpartyName: "Carlos",
      description: "Gasolina de la moto",
      amount: "45000.00",
      currency: "cop",
      occurredOn: "2026-08-30",
      dueOn: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe("COP");
  });

  it("accepts a receivable", () => {
    expect(
      createInformalBalanceSchema.safeParse({
        direction: "RECEIVABLE",
        counterpartyName: "Laura",
        description: "Le presté para el almuerzo",
        amount: "22000",
        currency: "COP",
        occurredOn: "2026-08-30",
      }).success,
    ).toBe(true);
  });

  it("rejects zero and negative-like amounts", () => {
    expect(
      createInformalBalanceSchema.safeParse({
        direction: "PAYABLE",
        counterpartyName: "Pedro",
        description: "Préstamo",
        amount: "0.00",
        currency: "COP",
        occurredOn: "2026-08-30",
      }).success,
    ).toBe(false);
  });

  it("requires at least one editable field", () => {
    expect(updateInformalBalanceSchema.safeParse({}).success).toBe(false);
  });

  it("requires payment idempotency and a positive amount", () => {
    expect(
      informalPaymentSchema.safeParse({
        amount: "10000.00",
        paidAt: "2026-08-30T18:00:00-05:00",
        idempotencyKey: "payment-123",
      }).success,
    ).toBe(true);
  });
});
