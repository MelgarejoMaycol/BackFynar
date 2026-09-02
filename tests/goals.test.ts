import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateGoalProjection } from "../src/modules/goals/goals.projection.js";
import {
  createContributionSchema,
  createGoalSchema,
  updateGoalSchema,
} from "../src/modules/goals/goals.schemas.js";

describe("metas de ahorro", () => {
  it("valida creación y rechaza montos inválidos", () => {
    expect(
      createGoalSchema.safeParse({
        name: "Moto",
        targetAmount: "8000000.00",
        targetDate: "2027-09-02",
        color: "#154B45",
      }).success,
    ).toBe(true);
    expect(createGoalSchema.safeParse({ name: "Moto", targetAmount: "0" }).success).toBe(false);
    expect(updateGoalSchema.safeParse({}).success).toBe(false);
  });

  it("acepta aportes y retiros pero no cero", () => {
    expect(createContributionSchema.safeParse({ amount: "300000.00" }).success).toBe(true);
    expect(createContributionSchema.safeParse({ amount: "-50000.00" }).success).toBe(true);
    expect(createContributionSchema.safeParse({ amount: "0.00" }).success).toBe(false);
  });

  it("calcula progreso, faltante y aporte mensual sugerido", () => {
    const result = calculateGoalProjection({
      targetAmount: new Prisma.Decimal("1200000"),
      savedAmount: new Prisma.Decimal("300000"),
      targetDate: new Date("2027-09-02T00:00:00Z"),
      contributions: [],
      now: new Date("2026-09-02T12:00:00Z"),
    });
    expect(result.savedAmount).toBe("300000.00");
    expect(result.remainingAmount).toBe("900000.00");
    expect(result.percentage).toBe("25.00");
    expect(Number(result.suggestedMonthlyAmount)).toBeGreaterThan(74000);
    expect(Number(result.suggestedMonthlyAmount)).toBeLessThan(76000);
    expect(result.estimationReason).toBe("INSUFFICIENT_HISTORY");
  });

  it("estima fecha solo con historial suficiente", () => {
    const result = calculateGoalProjection({
      targetAmount: new Prisma.Decimal("1000000"),
      savedAmount: new Prisma.Decimal("400000"),
      targetDate: null,
      contributions: [
        { amount: new Prisma.Decimal("200000"), contributedAt: new Date("2026-06-01T12:00:00Z") },
        { amount: new Prisma.Decimal("200000"), contributedAt: new Date("2026-08-01T12:00:00Z") },
      ],
      now: new Date("2026-09-02T12:00:00Z"),
    });
    expect(result.estimationReason).toBe("ESTIMATED");
    expect(result.averageMonthlyContribution).not.toBeNull();
    expect(result.estimatedCompletionDate).not.toBeNull();
  });

  it("limita progreso visual a 100% y reporta excedente", () => {
    const result = calculateGoalProjection({
      targetAmount: new Prisma.Decimal("100"),
      savedAmount: new Prisma.Decimal("125"),
      targetDate: null,
      contributions: [],
      now: new Date("2026-09-02T12:00:00Z"),
    });
    expect(result.percentage).toBe("100.00");
    expect(result.remainingAmount).toBe("0.00");
    expect(result.surplusAmount).toBe("25.00");
    expect(result.estimationReason).toBe("COMPLETED");
  });
});
