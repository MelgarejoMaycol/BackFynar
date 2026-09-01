import { describe, expect, it } from "vitest";
import { addFrequency, calculateLendingSchedule, summarizeLendingSchedule } from "./lending.math.js";

describe("lending math", () => {
  it.each(["FIXED_PAYMENT", "FIXED_PRINCIPAL", "INTEREST_ONLY"] as const)(
    "amortiza a cero con %s",
    (method) => {
      const rows = calculateLendingSchedule({ principal: 1_000_000, ratePercent: 2, termCount: 12, method });
      expect(rows).toHaveLength(12);
      expect(rows.at(-1)?.closingPrincipal).toBe(0);
      expect(rows.reduce((sum, row) => sum + row.principalAmount, 0)).toBeCloseTo(1_000_000, 2);
      expect(rows.every((row) => row.totalAmount === Math.round((row.principalAmount + row.interestAmount) * 100) / 100)).toBe(true);
    },
  );

  it("mantiene capital fijo salvo el ajuste final de centavos", () => {
    const rows = calculateLendingSchedule({ principal: 100, ratePercent: 1, termCount: 3, method: "FIXED_PRINCIPAL" });
    expect(rows.map((row) => row.principalAmount)).toEqual([33.33, 33.33, 33.34]);
  });

  it("expone interés y total coherentes", () => {
    const summary = summarizeLendingSchedule(calculateLendingSchedule({ principal: 500_000, ratePercent: 0, termCount: 5, method: "FIXED_PAYMENT" }));
    expect(summary).toEqual({ installmentAmount: 100_000, totalInterest: 0, totalReceivable: 500_000 });
  });

  it("calcula frecuencias sin convertir silenciosamente la tasa", () => {
    const date = new Date("2026-01-31T00:00:00.000Z");
    expect(addFrequency(date, "WEEKLY", 1).toISOString().slice(0, 10)).toBe("2026-02-07");
    expect(addFrequency(date, "BIWEEKLY", 1).toISOString().slice(0, 10)).toBe("2026-02-14");
    expect(addFrequency(date, "MONTHLY", 1).toISOString().slice(0, 10)).toBe("2026-03-03");
  });
});
