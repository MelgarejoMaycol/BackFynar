import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AccountsRepository } from "../src/modules/accounts/accounts.repository.js";
import type { BudgetsService } from "../src/modules/budgets/budgets.service.js";
import type { DashboardService } from "../src/modules/dashboard/dashboard.service.js";
import type { ExchangeRatesService } from "../src/modules/exchange-rates/exchange-rates.service.js";
import type { ForecastsService } from "../src/modules/forecasts/forecasts.service.js";
import {
  investmentScenarioSchema,
  investmentSimulationSchema,
} from "../src/modules/simulations/simulations.schemas.js";
import { SimulationsService } from "../src/modules/simulations/simulations.service.js";
import { simulateInvestment } from "../src/modules/simulations/investment-simulation.engine.js";

const forecasts = {} as ForecastsService;
const accounts = {} as AccountsRepository;
const budgets = {} as BudgetsService;
const dashboard = {} as DashboardService;
const exchangeRates = {} as ExchangeRatesService;

describe("investment simulation engine", () => {
  it("modela aportes periódicos y conserva separados aportes y rendimiento", () => {
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

    expect(result.currency).toBe("COP");
    expect(result.timeline).toHaveLength(121);
    expect(result.totalContributions).toBe("41000000.00");
    expect(new Prisma.Decimal(result.estimatedFinalValue).gt(result.totalContributions)).toBe(true);
    expect(new Prisma.Decimal(result.estimatedProfit).gt(0)).toBe(true);
    expect(new Prisma.Decimal(result.inflationAdjustedValue).lt(result.estimatedFinalValue)).toBe(true);
    expect(result.assumptions.some((item) => item.includes("modifica cuentas"))).toBe(true);
  });

  it("soporta aportes diarios y semanales con el total anual esperado", () => {
    const daily = simulateInvestment({
      currency: "COP",
      initialAmount: "1000",
      recurringContribution: "10",
      contributionFrequency: "DAILY",
      years: 1,
      annualReturn: "0",
      annualFee: "0",
      inflationRate: "0",
    });
    const weekly = simulateInvestment({
      currency: "COP",
      initialAmount: "1000",
      recurringContribution: "100",
      contributionFrequency: "WEEKLY",
      years: 1,
      annualReturn: "0",
      annualFee: "0",
      inflationRate: "0",
    });

    expect(daily.totalContributions).toBe("4650.00");
    expect(weekly.totalContributions).toBe("6200.00");
    expect(daily.timeline).toHaveLength(13);
    expect(weekly.timeline).toHaveLength(13);
  });

  it("permite escenarios con pérdidas sin bajar de -100%", () => {
    const result = simulateInvestment({
      currency: "USD",
      initialAmount: "1000",
      recurringContribution: "0",
      contributionFrequency: "NONE",
      years: 2,
      annualReturn: "-0.30",
      annualFee: "0",
      inflationRate: "0",
    });

    expect(new Prisma.Decimal(result.estimatedFinalValue).lt(result.initialAmount)).toBe(true);
    expect(new Prisma.Decimal(result.estimatedFinalValue).gt(0)).toBe(true);
  });
});

describe("investment simulation service", () => {
  it("genera escenarios conservador, base y optimista", () => {
    const service = new SimulationsService(
      forecasts,
      accounts,
      budgets,
      dashboard,
      exchangeRates,
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

    expect(result.scenarios.map((item) => item.label)).toEqual([
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
        convertedAmount: new Prisma.Decimal(amount).mul(4000).toFixed(2),
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
    expect(result.recurringContribution.monthlyEquivalentBase).toBe("400000.00");
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
  });

  it("acepta frecuencias diaria y semanal", () => {
    expect(
      investmentSimulationSchema.parse({
        currency: "COP",
        initialAmount: "100000",
        recurringContribution: "5000",
        contributionFrequency: "DAILY",
        years: 1,
        annualReturn: "0.08",
      }).contributionFrequency,
    ).toBe("DAILY");
    expect(
      investmentSimulationSchema.parse({
        currency: "COP",
        initialAmount: "100000",
        recurringContribution: "5000",
        contributionFrequency: "WEEKLY",
        years: 1,
        annualReturn: "0.08",
      }).contributionFrequency,
    ).toBe("WEEKLY");
  });

  it("rechaza rendimientos imposibles y escenarios fuera de rango", () => {
    expect(
      investmentSimulationSchema.safeParse({
        currency: "COP",
        initialAmount: "5000000",
        years: 10,
        annualReturn: "-1",
      }).success,
    ).toBe(false);
    expect(
      investmentScenarioSchema.safeParse({
        currency: "COP",
        initialAmount: "5000000",
        years: 10,
        baseAnnualReturn: "0.08",
        spread: "0.75",
      }).success,
    ).toBe(false);
  });
});
