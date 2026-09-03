import { describe, expect, it } from "vitest";
import { fixedPayment } from "../src/modules/simulations/simulations.service.js";

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
});
