import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { budgetUtcRange, projectionDays } from "../src/modules/budgets/budgets.dates.js";
import { budgetProgress, budgetStatus } from "../src/modules/budgets/budgets.service.js";
import { buildDashboardPeriod } from "../src/modules/dashboard/dashboard.period.js";
import {
  budgetCurrencySchema,
  budgetMoneySchema,
  budgetThresholdSchema,
  createBudgetSchema,
  listBudgetsSchema,
  updateBudgetSchema,
} from "../src/modules/budgets/budgets.schemas.js";
const base = {
  name: "Agosto",
  period: "MONTHLY",
  startsOn: "2026-08-01",
  endsOn: "2026-08-31",
  amount: "1000.00",
  currency: "COP",
};
describe("presupuestos", () => {
  it("valida un payload estricto y normaliza minúsculas", () => {
    expect(createBudgetSchema.parse({ ...base, currency: "cop" }).currency).toBe("COP");
    expect(createBudgetSchema.safeParse({ ...base, workspaceId: "x" }).success).toBe(false);
  });
  it.each([" COP ", "US", "USDT", "123"])("rechaza moneda %s", (currency) => {
    expect(budgetCurrencySchema.safeParse(currency).success).toBe(false);
  });
  it.each(["0", "-1", "1e3", "NaN", "Infinity", "1.001", "10000000000000000.00"])(
    "rechaza amount %s",
    (amount) => {
      expect(budgetMoneySchema.safeParse(amount).success).toBe(false);
    },
  );
  it.each(["0", "100.01", "-1", "Infinity"])("rechaza threshold %s", (threshold) => {
    expect(budgetThresholdSchema.safeParse(threshold).success).toBe(false);
  });
  it("valida periodos semanales, mensuales, anuales y custom", () => {
    expect(
      createBudgetSchema.safeParse({
        ...base,
        period: "WEEKLY",
        startsOn: "2026-08-01",
        endsOn: "2026-08-07",
      }).success,
    ).toBe(true);
    expect(
      createBudgetSchema.safeParse({ ...base, period: "WEEKLY", endsOn: "2026-08-08" }).success,
    ).toBe(false);
    expect(createBudgetSchema.safeParse({ ...base, startsOn: "2026-08-02" }).success).toBe(false);
    expect(
      createBudgetSchema.safeParse({
        ...base,
        period: "YEARLY",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
      }).success,
    ).toBe(true);
    expect(
      createBudgetSchema.safeParse({
        ...base,
        period: "CUSTOM",
        startsOn: "2026-08-02",
        endsOn: "2026-08-01",
      }).success,
    ).toBe(false);
  });
  it("rechaza IDs repetidos y campos calculados", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(createBudgetSchema.safeParse({ ...base, categoryIds: [id, id] }).success).toBe(false);
    expect(createBudgetSchema.safeParse({ ...base, spent: "1" }).success).toBe(false);
  });
  it("valida PATCH y filtros paginados", () => {
    expect(updateBudgetSchema.safeParse({}).success).toBe(false);
    expect(listBudgetsSchema.parse({ currency: "usd", limit: "100" })).toMatchObject({
      currency: "USD",
      limit: 100,
      page: 1,
    });
    expect(listBudgetsSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
  it("calcula SAFE, WARNING y EXCEEDED con Decimal", () => {
    const amount = new Prisma.Decimal(100),
      threshold = new Prisma.Decimal(80);
    expect(budgetStatus(new Prisma.Decimal(79), amount, threshold)).toBe("SAFE");
    expect(budgetStatus(new Prisma.Decimal(80), amount, threshold)).toBe("WARNING");
    expect(budgetStatus(new Prisma.Decimal(101), amount, threshold)).toBe("EXCEEDED");
  });
  it("calcula porcentaje, restante y proyección durante el periodo", () => {
    expect(
      budgetProgress(new Prisma.Decimal(40), new Prisma.Decimal(100), new Prisma.Decimal(80), {
        elapsed: 2,
        total: 10,
        phase: "DURING",
      }),
    ).toEqual({
      progress: { spent: "40.00", remaining: "60.00", percentage: "40.00", status: "SAFE" },
      projection: {
        projectedSpend: "200.00",
        projectedRemaining: "-100.00",
        projectedPercentage: "200.00",
        projectedStatus: "EXCEEDED",
      },
    });
  });
  it("proyecta cero antes y gasto real después", () => {
    const amount = new Prisma.Decimal(100),
      threshold = new Prisma.Decimal(80);
    expect(
      budgetProgress(new Prisma.Decimal(20), amount, threshold, {
        elapsed: 0,
        total: 10,
        phase: "BEFORE",
      }).projection.projectedSpend,
    ).toBe("0.00");
    expect(
      budgetProgress(new Prisma.Decimal(20), amount, threshold, {
        elapsed: 10,
        total: 10,
        phase: "AFTER",
      }).projection.projectedSpend,
    ).toBe("20.00");
  });
  it("calcula límites exclusivos con zona horaria y DST", () => {
    expect(budgetUtcRange("2026-03-08", "2026-03-08", "America/New_York")).toEqual({
      start: new Date("2026-03-08T05:00:00Z"),
      endExclusive: new Date("2026-03-09T04:00:00Z"),
    });
  });
  it("calcula días antes, durante y después", () => {
    expect(
      projectionDays("2026-08-01", "2026-08-10", "UTC", new Date("2026-07-31T12:00:00Z")),
    ).toMatchObject({ elapsed: 0, total: 10, phase: "BEFORE" });
    expect(
      projectionDays("2026-08-01", "2026-08-10", "UTC", new Date("2026-08-05T12:00:00Z")),
    ).toMatchObject({ elapsed: 5, total: 10, phase: "DURING" });
    expect(
      projectionDays("2026-08-01", "2026-08-10", "UTC", new Date("2026-08-11T12:00:00Z")),
    ).toMatchObject({ elapsed: 10, total: 10, phase: "AFTER" });
  });
  it("reutiliza Mi ciclo del Dashboard y genera 25 de julio a 24 de agosto", () => {
    const range = buildDashboardPeriod(
      { period: "MY_CYCLE", recentLimit: 1 },
      "America/Bogota",
      new Date("2026-08-18T17:00:00Z"),
      25,
    );
    expect(range.start).toEqual(new Date("2026-07-25T05:00:00Z"));
    expect(new Date(range.endExclusive.getTime() - 1)).toEqual(new Date("2026-08-25T04:59:59.999Z"));
  });
});
