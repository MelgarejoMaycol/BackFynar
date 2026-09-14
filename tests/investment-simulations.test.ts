import { describe, expect, it, vi } from "vitest";
import type { AccountsRepository } from "../src/modules/accounts/accounts.repository.js";
import type { BudgetsService } from "../src/modules/budgets/budgets.service.js";
import type { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import type { ExchangeRatesService } from "../src/modules/exchange-rates/exchange-rates.service.js";
import type { ForecastsService } from "../src/modules/forecasts/forecasts.service.js";
import { simulateInvestment } from "../src/modules/simulations/investment-simulation.engine.js";
import {
  investmentFinancialImpactSchema,
  investmentScenarioSchema,
  investmentSimulationSchema,
} from "../src/modules/simulations/simulations.schemas.js";
import { SimulationsService } from "../src/modules/simulations/simulations.service.js";

describe("investment simulation engine", () => {
  it("capitaliza mensualmente y conserva separados aportes y rendimiento", () => {
    const result = simulateInvestment({
      currency: "COP",
      initialAmount: "5000000",
      recurringContribution: "300000",
      contributionFrequency: "MONTHLY",
      years: 10,
      annualReturn: "0.08",
      annualFee: "0",
      inflationRate: "0.04",
    });

    expect(result.totalContributions).toBe("41000000.00");
    expect(Number(result.estimatedFinalValue)).toBeGreaterThan(41000000);
    expect(Number(result.estimatedProfit)).toBeGreaterThan(0);
    expect(Number(result.inflationAdjustedValue)).toBeLessThan(
      Number(result.estimatedFinalValue),
    );
    expect(result.timeline).toHaveLength(121);
    expect(result.timeline.at(-1)?.month).toBe(120);
  });

  it("permite escenarios con pérdidas sin bajar de -100%", () => {
    const result = simulateInvestment({
      currency: "USD",
      initialAmount: "1000",
      recurringContribution: "0",
      contributionFrequency: "NONE",
      years: 2,
      annualReturn: "-0.20",
      annualFee: "0",
      inflationRate: "0",
    });

    expect(Number(result.estimatedFinalValue)).toBeLessThan(1000);
    expect(Number(result.estimatedFinalValue)).toBeGreaterThan(0);
  });
});

describe("investment simulation service", () => {
  const forecasts = {} as ForecastsService;
  const accounts = {} as AccountsRepository;
  const budgets = {} as BudgetsService;

  it("genera escenarios conservador, base y optimista", () => {
    const service = new SimulationsService(
      forecasts,
      accounts,
      budgets,
      {} as DashboardService,
      {
        currencies: () => ({
          defaultBase: "COP",
          currencies: [{ code: "COP", name: "Peso colombiano", symbol: "$", minorUnits: 2 }],
        }),
      } as ExchangeRatesService,
    );

    const result = service.investmentScenarios({
      currency: "COP",
      initialAmount: "5000000",
      recurringContribution: "300000",
      contributionFrequency: "MONTHLY",
      years: 10,
      baseAnnualReturn: "0.08",
      spread: "0.04",
      annualFee: "0",
      inflationRate: "0.04",
    });

    expect(result.scenarios.map((scenario) => scenario.label)).toEqual([
      "CONSERVATIVE",
      "BASE",
      "OPTIMISTIC",
    ]);
    expect(Number(result.scenarios[0]!.estimatedFinalValue)).toBeLessThan(
      Number(result.scenarios[1]!.estimatedFinalValue),
    );
    expect(Number(result.scenarios[1]!.estimatedFinalValue)).toBeLessThan(
      Number(result.scenarios[2]!.estimatedFinalValue),
    );
  });

  it("compara una inversión con la situación real sin modificarla", async () => {
    const dashboard = {
      get: vi.fn().mockResolvedValue({
        summariesByCurrency: [
          {
            currency: "COP",
            availableMoney: "8000000.00",
            totalIncome: "5000000.00",
            totalExpenses: "3000000.00",
            netCashFlow: "2000000.00",
            scheduledPayments: "600000.00",
          },
        ],
      }),
    } as unknown as DashboardService;
    const exchangeRates = {
      currencies: () => ({
        defaultBase: "COP",
        currencies: [
          { code: "COP", name: "Peso colombiano", symbol: "$", minorUnits: 2 },
          { code: "USD", name: "Dólar estadounidense", symbol: "$", minorUnits: 2 },
        ],
      }),
      convert: vi.fn().mockImplementation(async (_from: string, _to: string, amount: string) => ({
        convertedAmount: String(Number(amount) * 4000),
        rate: "4000",
        date: "2026-09-14",
      })),
    } as unknown as ExchangeRatesService;
    const service = new SimulationsService(
      forecasts,
      accounts,
      budgets,
      dashboard,
      exchangeRates,
    );

    const result = await service.investmentFinancialImpact(
      "workspace",
      "COP",
      "America/Bogota",
      "user",
      { currency: "USD", initialAmount: "1000", recurringContribution: "100" },
      new Date("2026-09-14T12:00:00Z"),
    );

    expect(result.initialInvestment.baseEquivalent).toBe("4000000.00");
    expect(result.remainingAvailableMoney).toBe("4000000.00");
    expect(result.liquidityPercentageUsed).toBe("50.00");
    expect(result.impact.level).toBe("MODERATE");
    expect(dashboard.get).toHaveBeenCalledTimes(1);
  });
});

describe("investment simulation contracts", () => {
  it("normaliza entradas y aplica valores predeterminados", () => {
    expect(
      investmentSimulationSchema.parse({
        currency: "cop",
        initialAmount: "5000000",
        years: 10,
        annualReturn: "0.08",
      }),
    ).toMatchObject({
      currency: "COP",
      recurringContribution: "0",
      contributionFrequency: "MONTHLY",
      annualFee: "0",
      inflationRate: "0",
    });

    expect(
      investmentFinancialImpactSchema.parse({
        currency: "usd",
        initialAmount: "1000",
      }),
    ).toEqual({
      currency: "USD",
      initialAmount: "1000",
      recurringContribution: "0",
    });
  });

  it("rechaza rendimientos imposibles y escenarios fuera de rango", () => {
    expect(
      investmentSimulationSchema.safeParse({
        currency: "COP",
        initialAmount: "1000",
        years: 10,
        annualReturn: "-1",
      }).success,
    ).toBe(false);

    expect(
      investmentScenarioSchema.safeParse({
        currency: "COP",
        initialAmount: "1000",
        years: 10,
        baseAnnualReturn: "0.08",
        spread: "0.9",
      }).success,
    ).toBe(false);
  });
});
