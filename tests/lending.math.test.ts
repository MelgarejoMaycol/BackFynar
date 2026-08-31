import { describe, expect, it } from "vitest";
import {
  calculateLendingSchedule,
  summarizeLendingSchedule,
} from "../src/modules/lending/lending.math.js";

describe("lending math", () => {
  it("calculates a fixed-payment loan and closes the balance", () => {
    const rows = calculateLendingSchedule({
      principal: 2_000_000,
      ratePercent: 3,
      termCount: 12,
      method: "FIXED_PAYMENT",
    });
    const summary = summarizeLendingSchedule(rows);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.interestAmount).toBe(60_000);
    expect(rows[11]?.closingPrincipal).toBe(0);
    expect(summary.totalPrincipal).toBe(2_000_000);
    expect(summary.totalInterest).toBeGreaterThan(400_000);
    expect(summary.totalInterest).toBeLessThan(420_000);
  });

  it("supports zero-interest loans without losing cents", () => {
    const rows = calculateLendingSchedule({
      principal: 1_000_000,
      ratePercent: 0,
      termCount: 3,
      method: "FIXED_PAYMENT",
    });
    const summary = summarizeLendingSchedule(rows);
    expect(rows[2]?.closingPrincipal).toBe(0);
    expect(summary.totalPrincipal).toBe(1_000_000);
    expect(summary.totalInterest).toBe(0);
    expect(summary.totalReceivable).toBe(1_000_000);
  });

  it("supports fixed principal", () => {
    const rows = calculateLendingSchedule({
      principal: 1_200_000,
      ratePercent: 2,
      termCount: 12,
      method: "FIXED_PRINCIPAL",
    });
    expect(rows[0]?.principalAmount).toBe(100_000);
    expect(rows[1]?.interestAmount).toBeLessThan(rows[0]!.interestAmount);
    expect(rows[11]?.closingPrincipal).toBe(0);
  });

  it("supports interest-only schedules", () => {
    const rows = calculateLendingSchedule({
      principal: 500_000,
      ratePercent: 4,
      termCount: 4,
      method: "INTEREST_ONLY",
    });
    expect(rows[0]?.principalAmount).toBe(0);
    expect(rows[2]?.principalAmount).toBe(0);
    expect(rows[3]?.principalAmount).toBe(500_000);
    expect(rows[3]?.closingPrincipal).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() =>
      calculateLendingSchedule({ principal: 0, ratePercent: 2, termCount: 12, method: "FIXED_PAYMENT" }),
    ).toThrow();
    expect(() =>
      calculateLendingSchedule({ principal: 100, ratePercent: -1, termCount: 12, method: "FIXED_PAYMENT" }),
    ).toThrow();
    expect(() =>
      calculateLendingSchedule({ principal: 100, ratePercent: 1, termCount: 0, method: "FIXED_PAYMENT" }),
    ).toThrow();
  });
});
