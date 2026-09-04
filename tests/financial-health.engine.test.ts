import { describe, expect, it } from "vitest";
import {
  buildFinancialHealth,
  FINANCIAL_HEALTH_VERSION,
  type FinancialHealthDimensionId,
} from "../src/modules/financial-health/financial-health.engine.js";

const completeInput = {
  currency: "COP",
  liquidAvailable: "6000000.00",
  monthlyExpenseReference: "2000000.00",
  totalDebt: "6000000.00",
  monthlyIncomeReference: "3000000.00",
  budgetAmount: "2000000.00",
  projectedBudgetSpend: "2200000.00",
  periodIncome: "3000000.00",
  periodExpenses: "2400000.00",
  paymentsDue: 4,
  paymentsOnTime: 3,
  paymentsLateOrMissed: 1,
};

describe("salud financiera v1", () => {
  it("produce el mismo score y versión con el mismo conjunto de datos", () => {
    const first = buildFinancialHealth(completeInput);
    const second = buildFinancialHealth(completeInput);

    expect(first).toEqual(second);
    expect(first.version).toBe(FINANCIAL_HEALTH_VERSION);
    expect(first.availableDimensions).toBe(5);
    expect(first.coverage).toBe(100);
    expect(first.score).not.toBeNull();
    expect(first.methodology.aggregation).toContain("Promedio simple");
    expect(first.methodology.disclaimer).toContain("No es un score crediticio");
  });

  it("calcula cada dimensión con factores trazables", () => {
    const result = buildFinancialHealth(completeInput);
    const dimension = (id: FinancialHealthDimensionId) => {
      const found = result.dimensions.find((item) => item.id === id);
      expect(found).toBeDefined();
      return found!;
    };

    expect(dimension("LIQUIDITY").score).toBe(100);
    expect(dimension("LIQUIDITY").metrics.coverageMonths).toBe(3);
    expect(dimension("DEBT").metrics.debtToAnnualIncome).toBeCloseTo(1 / 6, 4);
    expect(dimension("SPENDING_CONTROL").score).toBe(90);
    expect(dimension("SPENDING_CONTROL").metrics.projectedUtilization).toBe(1.1);
    expect(dimension("SAVINGS").score).toBe(100);
    expect(dimension("SAVINGS").metrics.savingsRate).toBe(0.2);
    expect(dimension("PAYMENT_COMPLIANCE").score).toBe(75);
    expect(dimension("PAYMENT_COMPLIANCE").metrics.onTimeRate).toBe(0.75);
  });

  it("no publica puntuación general con menos de tres dimensiones disponibles", () => {
    const result = buildFinancialHealth({
      currency: "COP",
      liquidAvailable: "1000000.00",
      monthlyExpenseReference: null,
      totalDebt: "0.00",
      monthlyIncomeReference: null,
      budgetAmount: "0.00",
      projectedBudgetSpend: "0.00",
      periodIncome: "0.00",
      periodExpenses: "0.00",
      paymentsDue: 0,
      paymentsOnTime: 0,
      paymentsLateOrMissed: 0,
    });

    expect(result.availableDimensions).toBe(1);
    expect(result.coverage).toBe(20);
    expect(result.score).toBeNull();
    expect(result.band).toBe("INSUFFICIENT");
    expect(result.dimensions.filter((item) => !item.available)).toHaveLength(4);
  });

  it("no confunde ausencia de deuda con falta de datos", () => {
    const result = buildFinancialHealth({ ...completeInput, totalDebt: "0.00" });
    const debt = result.dimensions.find((item) => item.id === "DEBT");

    expect(debt).toMatchObject({ available: true, score: 100, status: "SOLID" });
    expect(debt?.metrics.totalDebt).toBe("0.00");
  });

  it("no castiga la puntuación cuando hay deuda pero todavía falta ingreso de referencia", () => {
    const result = buildFinancialHealth({
      ...completeInput,
      totalDebt: "2500000.00",
      monthlyIncomeReference: null,
    });
    const debt = result.dimensions.find((item) => item.id === "DEBT");

    expect(debt).toMatchObject({
      available: false,
      score: null,
      status: "INSUFFICIENT",
    });
    expect(debt?.metrics.totalDebt).toBe("2500000.00");
    expect(debt?.metrics.debtToAnnualIncome).toBeNull();
    expect(result.availableDimensions).toBe(4);
    expect(result.coverage).toBe(80);
    expect(result.methodology.rules.join(" ")).toContain("sin ingreso de referencia suficiente");
  });

  it("genera recomendaciones solo desde métricas concretas y acciones existentes", () => {
    const result = buildFinancialHealth({
      ...completeInput,
      liquidAvailable: "500000.00",
      totalDebt: "40000000.00",
      projectedBudgetSpend: "5000000.00",
      periodExpenses: "3500000.00",
      paymentsOnTime: 1,
      paymentsLateOrMissed: 3,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of result.recommendations) {
      expect(recommendation.title.length).toBeGreaterThan(0);
      expect(recommendation.detail.length).toBeGreaterThan(0);
      expect(recommendation.action.url).toMatch(/^\/app\//);
    }
  });
});
