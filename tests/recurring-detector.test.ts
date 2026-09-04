import { describe, expect, it } from "vitest";
import {
  detectRecurringPayments,
  normalizeRecurringLabel,
  type RecurringDetectionTransaction,
} from "../src/modules/recurring-detection/domain/index.js";

function expense(
  id: string,
  date: string,
  amount: number,
  merchantName: string,
  overrides: Partial<RecurringDetectionTransaction> = {},
): RecurringDetectionTransaction {
  return {
    id,
    type: "EXPENSE",
    status: "CONFIRMED",
    amount,
    occurredAt: date,
    accountId: "account-nequi",
    categoryId: "category-entertainment",
    merchantName,
    description: null,
    ...overrides,
  };
}

describe("normalizeRecurringLabel", () => {
  it("normalizes accents, punctuation and common payment noise", () => {
    expect(normalizeRecurringLabel("Pago NETFLIX.COM - Tarjeta")).toBe("netflix");
  });
});

describe("detectRecurringPayments", () => {
  it("detects a fixed monthly subscription with at least three pieces of evidence", () => {
    const result = detectRecurringPayments([
      expense("t1", "2026-05-05T12:00:00.000Z", 26900, "Netflix"),
      expense("t2", "2026-06-05T12:00:00.000Z", 26900, "Netflix"),
      expense("t3", "2026-07-06T12:00:00.000Z", 26900, "Netflix"),
      expense("t4", "2026-08-05T12:00:00.000Z", 26900, "Netflix"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      normalizedLabel: "netflix",
      frequency: "MONTHLY",
      amountType: "FIXED",
      typicalAmount: 26900,
      evidenceCount: 4,
      accountId: "account-nequi",
      categoryId: "category-entertainment",
    });
    expect(result[0]!.confidence).toBeGreaterThanOrEqual(0.65);
    expect(result[0]!.transactionIds).toEqual(["t1", "t2", "t3", "t4"]);
    expect(result[0]!.nextExpectedAt.toISOString().slice(0, 10)).toBe("2026-09-05");
  });

  it("detects a variable monthly utility payment", () => {
    const result = detectRecurringPayments([
      expense("e1", "2026-04-10T12:00:00.000Z", 95300, "ESSA Energía"),
      expense("e2", "2026-05-10T12:00:00.000Z", 102800, "ESSA Energia"),
      expense("e3", "2026-06-11T12:00:00.000Z", 91400, "ESSA ENERGIA"),
      expense("e4", "2026-07-10T12:00:00.000Z", 107000, "ESSA Energía"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.frequency).toBe("MONTHLY");
    expect(result[0]!.amountType).toBe("VARIABLE");
    expect(result[0]!.minAmount).toBe(91400);
    expect(result[0]!.maxAmount).toBe(107000);
  });

  it("does not suggest a pattern with only two movements", () => {
    const result = detectRecurringPayments([
      expense("t1", "2026-07-05T12:00:00.000Z", 26900, "Netflix"),
      expense("t2", "2026-08-05T12:00:00.000Z", 26900, "Netflix"),
    ]);

    expect(result).toEqual([]);
  });

  it("does not confuse transfers or debt payments with recurring payments", () => {
    const transactions: RecurringDetectionTransaction[] = [
      expense("t1", "2026-05-01T12:00:00.000Z", 150000, "Transferencia ahorro", {
        type: "TRANSFER",
      }),
      expense("t2", "2026-06-01T12:00:00.000Z", 150000, "Transferencia ahorro", {
        type: "TRANSFER",
      }),
      expense("t3", "2026-07-01T12:00:00.000Z", 150000, "Transferencia ahorro", {
        type: "TRANSFER",
      }),
      expense("d1", "2026-05-03T12:00:00.000Z", 420000, "Cuota moto", {
        type: "DEBT_PAYMENT",
      }),
      expense("d2", "2026-06-03T12:00:00.000Z", 420000, "Cuota moto", {
        type: "DEBT_PAYMENT",
      }),
      expense("d3", "2026-07-03T12:00:00.000Z", 420000, "Cuota moto", {
        type: "DEBT_PAYMENT",
      }),
    ];

    expect(detectRecurringPayments(transactions)).toEqual([]);
  });

  it("rejects irregular dates even when merchant and amount match", () => {
    const result = detectRecurringPayments([
      expense("t1", "2026-01-01T12:00:00.000Z", 50000, "Tienda X"),
      expense("t2", "2026-01-04T12:00:00.000Z", 50000, "Tienda X"),
      expense("t3", "2026-02-21T12:00:00.000Z", 50000, "Tienda X"),
      expense("t4", "2026-04-02T12:00:00.000Z", 50000, "Tienda X"),
    ]);

    expect(result).toEqual([]);
  });

  it("keeps the same merchant on different accounts as separate candidates", () => {
    const result = detectRecurringPayments([
      expense("a1", "2026-05-05T12:00:00.000Z", 26900, "Netflix", { accountId: "a" }),
      expense("a2", "2026-06-05T12:00:00.000Z", 26900, "Netflix", { accountId: "a" }),
      expense("a3", "2026-07-05T12:00:00.000Z", 26900, "Netflix", { accountId: "a" }),
      expense("b1", "2026-05-10T12:00:00.000Z", 26900, "Netflix", { accountId: "b" }),
      expense("b2", "2026-06-10T12:00:00.000Z", 26900, "Netflix", { accountId: "b" }),
      expense("b3", "2026-07-10T12:00:00.000Z", 26900, "Netflix", { accountId: "b" }),
    ]);

    expect(result).toHaveLength(2);
    expect(new Set(result.map((candidate) => candidate.accountId))).toEqual(new Set(["a", "b"]));
  });
});
