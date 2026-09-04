import { describe, expect, it } from "vitest";
import { financingSchedule, fixedPayment } from "../src/modules/simulations/simulations.service.js";

describe("purchase simulator financing math", () => {
  it("splits an interest-free purchase evenly", () => {
    expect(fixedPayment(1_200_000, 12, 0)).toBe(100_000);
  });

  it("returns the full amount for a single installment", () => {
    expect(fixedPayment(850_000, 1, 0.02)).toBe(850_000);
  });

  it("uses the fixed-payment formula when there is a monthly rate", () => {
    expect(fixedPayment(3_000_000, 12, 0.018)).toBeCloseTo(280_205.93, 1);
  });

  it("builds a deterministic future installment schedule", () => {
    expect(financingSchedule(new Date("2026-09-04T12:00:00Z"), 3, 100_000)).toEqual([
      { installment: 1, date: "2026-09-04", amount: "100000.00" },
      { installment: 2, date: "2026-10-04", amount: "100000.00" },
      { installment: 3, date: "2026-11-04", amount: "100000.00" },
    ]);
  });
});
