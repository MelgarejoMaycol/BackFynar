import { describe, expect, it } from "vitest";
import { buildMonthEndForecast } from "../src/modules/forecasts/month-end-forecast.engine.js";

describe("proyección de fin de mes", () => {
  it("calcula saldo proyectado con ingresos, compromisos y gasto cotidiano", () => {
    const result = buildMonthEndForecast({
      currency: "COP",
      currentAvailable: "1350000",
      expectedIncome: "900000",
      knownCommitments: "785000",
      historicalVariableExpense: "600000",
      historyDays: 30,
      daysRemaining: 10,
      today: "2026-09-20",
      monthEnd: "2026-09-30",
      cashEvents: [
        {
          date: "2026-09-22",
          amount: "900000",
          direction: "IN",
          label: "Salario",
          source: "EXPECTED_INCOME",
        },
        {
          date: "2026-09-24",
          amount: "785000",
          direction: "OUT",
          label: "Compromisos",
          source: "KNOWN_COMMITMENT",
        },
      ],
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.dataQuality).toBe("MEDIUM");
    expect(result.estimatedVariableExpenses).toBe("200000.00");
    expect(result.projectedClosingBalance).toBe("1265000.00");
    expect(result.timeline).toHaveLength(11);
  });

  it("no inventa gasto variable cuando el historial es insuficiente", () => {
    const result = buildMonthEndForecast({
      currency: "COP",
      currentAvailable: "500000",
      expectedIncome: "0",
      knownCommitments: "150000",
      historicalVariableExpense: "50000",
      historyDays: 5,
      daysRemaining: 20,
      today: "2026-09-10",
      monthEnd: "2026-09-30",
      cashEvents: [],
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.estimatedVariableExpenses).toBeNull();
    expect(result.projectedClosingBalance).toBe("350000.00");
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("lleva compromisos vencidos al día actual para detectar riesgo de liquidez", () => {
    const result = buildMonthEndForecast({
      currency: "COP",
      currentAvailable: "100000",
      expectedIncome: "0",
      knownCommitments: "150000",
      historicalVariableExpense: "0",
      historyDays: 0,
      daysRemaining: 2,
      today: "2026-09-28",
      monthEnd: "2026-09-30",
      cashEvents: [
        {
          date: "2026-09-25",
          amount: "150000",
          direction: "OUT",
          label: "Pago vencido",
          source: "KNOWN_COMMITMENT",
        },
      ],
    });

    expect(result.lowestProjectedBalance.amount).toBe("-50000.00");
    expect(result.lowestProjectedBalance.date).toBe("2026-09-28");
  });
});
