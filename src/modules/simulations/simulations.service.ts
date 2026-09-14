import { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/app-error.js";
import { accountsRepository, type AccountsRepository } from "../accounts/accounts.repository.js";
import { budgetsService, type BudgetsService } from "../budgets/budgets.service.js";
import { forecastsService, type ForecastsService } from "../forecasts/forecasts.service.js";
import { dashboardService, type DashboardService } from "../dashboard/dashboard.service.js";
import {
  exchangeRatesService,
  type ExchangeRatesService,
} from "../exchange-rates/exchange-rates.service.js";
import { simulateInvestment } from "./investment-simulation.engine.js";
import type {
  InvestmentFinancialImpactBody,
  InvestmentScenarioBody,
  InvestmentSimulationBody,
  PurchaseSimulationInput,
} from "./simulations.schemas.js";

type ImpactLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

export function fixedPayment(principal: number, installments: number, monthlyRate: number): number {
  if (installments <= 1) return principal;
  if (monthlyRate === 0) return principal / installments;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -installments));
}

export function financingSchedule(start: Date, installments: number, payment: number) {
  return Array.from({ length: installments }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, start.getUTCDate()));
    return { installment: index + 1, date: date.toISOString().slice(0, 10), amount: money(payment) };
  });
}

function impactLevel(before: number, after: number, lowestAfter: number): ImpactLevel {
  if (after < 0 || lowestAfter < 0) return "CRITICAL";
  if (before <= 0) return after < before ? "HIGH" : "MODERATE";
  const remainingRatio = after / before;
  if (remainingRatio < 0.2) return "HIGH";
  if (remainingRatio < 0.55) return "MODERATE";
  return "LOW";
}

function impactCopy(level: ImpactLevel) {
  if (level === "CRITICAL") return { headline: "Esta compra podría dejarte sin margen para cubrir el periodo", explanation: "La simulación lleva tu saldo proyectado o tu punto de menor liquidez por debajo de cero." };
  if (level === "HIGH") return { headline: "Puedes asumirla, pero quedarías con muy poco margen", explanation: "La compra consumiría una parte importante del saldo que hoy proyectas conservar al cierre." };
  if (level === "MODERATE") return { headline: "La compra es posible, pero sí cambia tu margen del periodo", explanation: "Seguirías con saldo proyectado positivo, aunque con menos espacio para imprevistos." };
  return { headline: "La compra tendría un impacto bajo en tu proyección actual", explanation: "Con los compromisos y supuestos conocidos, conservarías la mayor parte de tu margen proyectado." };
}

export class SimulationsService {
  constructor(
    private readonly forecasts: ForecastsService = forecastsService,
    private readonly accounts: AccountsRepository = accountsRepository,
    private readonly budgets: BudgetsService = budgetsService,
    private readonly dashboard: DashboardService = dashboardService,
    private readonly exchangeRates: ExchangeRatesService = exchangeRatesService,
  ) {}


  investmentOptions(baseCurrency: string) {
    const currencies = this.exchangeRates.currencies();
    return {
      currencies: currencies.currencies,
      defaultCurrency: currencies.currencies.some((item) => item.code === baseCurrency)
        ? baseCurrency
        : currencies.defaultBase,
      contributionFrequencies: [
        { value: "NONE", label: "Sin aportes" },
        { value: "MONTHLY", label: "Mensual" },
        { value: "QUARTERLY", label: "Trimestral" },
        { value: "YEARLY", label: "Anual" },
      ],
      limits: { minYears: 1, maxYears: 50 },
      defaults: {
        years: 10,
        annualReturn: "0.08",
        annualFee: "0.00",
        inflationRate: "0.04",
        scenarioSpread: "0.04",
      },
    };
  }

  investment(input: InvestmentSimulationBody) {
    return simulateInvestment({
      ...input,
      recurringContribution: input.recurringContribution ?? "0",
      contributionFrequency: input.contributionFrequency ?? "MONTHLY",
      annualFee: input.annualFee ?? "0",
      inflationRate: input.inflationRate ?? "0",
    });
  }

  investmentScenarios(input: InvestmentScenarioBody) {
    const base = new Prisma.Decimal(input.baseAnnualReturn);
    const spread = new Prisma.Decimal(input.spread ?? "0.04");
    const floor = new Prisma.Decimal("-0.99");
    const conservativeRate = Prisma.Decimal.max(floor, base.minus(spread));
    const optimisticRate = base.plus(spread);
    const common = {
      currency: input.currency,
      initialAmount: input.initialAmount,
      recurringContribution: input.recurringContribution ?? "0",
      contributionFrequency: input.contributionFrequency ?? "MONTHLY",
      years: input.years,
      annualFee: input.annualFee ?? "0",
      inflationRate: input.inflationRate ?? "0",
    };

    const summarize = (label: "CONSERVATIVE" | "BASE" | "OPTIMISTIC", annualReturn: Prisma.Decimal) => {
      const result = simulateInvestment({
        ...common,
        annualReturn: annualReturn.toString(),
      });
      return {
        label,
        annualReturn: result.annualReturn,
        estimatedFinalValue: result.estimatedFinalValue,
        estimatedProfit: result.estimatedProfit,
        inflationAdjustedValue: result.inflationAdjustedValue,
        totalReturnPercentage: result.totalReturnPercentage,
      };
    };

    return {
      currency: input.currency,
      spread: spread.toDecimalPlaces(8).toFixed(8),
      scenarios: [
        summarize("CONSERVATIVE", conservativeRate),
        summarize("BASE", base),
        summarize("OPTIMISTIC", optimisticRate),
      ],
      disclaimer:
        "Los escenarios son estimaciones matemáticas basadas en tasas supuestas y no garantizan rendimientos futuros.",
    };
  }

  async investmentFinancialImpact(
    workspaceId: string,
    baseCurrency: string,
    timezone: string,
    userId: string,
    input: InvestmentFinancialImpactBody,
    now = new Date(),
  ) {
    const toBase = async (amount: string) => {
      if (input.currency === baseCurrency) {
        return {
          originalAmount: new Prisma.Decimal(amount).toFixed(2),
          convertedAmount: new Prisma.Decimal(amount).toFixed(2),
          rate: "1",
          date: now.toISOString().slice(0, 10),
        };
      }
      const converted = await this.exchangeRates.convert(input.currency, baseCurrency, amount);
      return {
        originalAmount: new Prisma.Decimal(amount).toFixed(2),
        convertedAmount: converted.convertedAmount,
        rate: converted.rate,
        date: converted.date,
      };
    };

    const [initialInBase, recurringInBase, dashboard] = await Promise.all([
      toBase(input.initialAmount),
      toBase(input.recurringContribution ?? "0"),
      this.dashboard.get(
        workspaceId,
        baseCurrency,
        timezone,
        { period: "CURRENT_MONTH", recentLimit: 1 },
        now,
        userId,
      ),
    ]);

    const summary =
      dashboard.summariesByCurrency.find((item) => item.currency === baseCurrency) ??
      dashboard.summariesByCurrency[0];

    if (!summary) {
      throw new AppError("No hay información financiera para comparar la inversión", {
        status: 409,
        code: "INVESTMENT_IMPACT_UNAVAILABLE",
        publicMessage: "Aún no hay suficiente información financiera para hacer la comparación.",
      });
    }

    const available = new Prisma.Decimal(summary.availableMoney);
    const initial = new Prisma.Decimal(initialInBase.convertedAmount);
    const recurring = new Prisma.Decimal(recurringInBase.convertedAmount);
    const income = new Prisma.Decimal(summary.totalIncome);
    const expenses = new Prisma.Decimal(summary.totalExpenses);
    const commitments = new Prisma.Decimal(summary.scheduledPayments);
    const netCashFlow = income.minus(expenses);
    const remaining = available.minus(initial);
    const liquidityUsed = available.gt(0) ? initial.div(available).mul(100) : new Prisma.Decimal(100);
    const positiveCashFlow = Prisma.Decimal.max(0, netCashFlow);
    const recurringShare = positiveCashFlow.gt(0)
      ? recurring.div(positiveCashFlow).mul(100)
      : recurring.gt(0)
        ? new Prisma.Decimal(100)
        : new Prisma.Decimal(0);

    const level: ImpactLevel =
      remaining.lt(0)
        ? "CRITICAL"
        : liquidityUsed.gte(80) || (recurring.gt(0) && recurring.gte(positiveCashFlow) && positiveCashFlow.gt(0))
          ? "HIGH"
          : liquidityUsed.gte(50) || recurringShare.gte(50)
            ? "MODERATE"
            : "LOW";

    const copy =
      level === "CRITICAL"
        ? {
            headline: "La inversión supera tu disponible actual",
            explanation:
              "Como simulación es válida, pero si saliera hoy de tus cuentas dejaría tu disponible por debajo de cero.",
          }
        : level === "HIGH"
          ? {
              headline: "La inversión consumiría una parte alta de tu liquidez",
              explanation:
                "Puedes simularla libremente, pero comparada con tus finanzas actuales reduciría de forma importante tu margen.",
            }
          : level === "MODERATE"
            ? {
                headline: "La inversión tendría un impacto moderado en tu liquidez",
                explanation:
                  "La simulación deja margen, aunque representa una parte relevante de tu disponible o de tu flujo mensual.",
              }
            : {
                headline: "La inversión tendría un impacto bajo sobre tu situación actual",
                explanation:
                  "Comparada con tu disponible y tu flujo del periodo, conservarías un margen amplio.",
              };

    return {
      simulationCurrency: input.currency,
      baseCurrency,
      initialInvestment: {
        original: initialInBase.originalAmount,
        baseEquivalent: initialInBase.convertedAmount,
      },
      recurringContribution: {
        original: recurringInBase.originalAmount,
        baseEquivalent: recurringInBase.convertedAmount,
      },
      availableMoney: available.toFixed(2),
      remainingAvailableMoney: remaining.toFixed(2),
      liquidityPercentageUsed: liquidityUsed.toDecimalPlaces(2).toFixed(2),
      currentPeriodIncome: income.toFixed(2),
      currentPeriodExpenses: expenses.toFixed(2),
      currentNetCashFlow: netCashFlow.toFixed(2),
      knownCommitments: commitments.toFixed(2),
      recurringContributionShareOfPositiveCashFlow: recurringShare.toDecimalPlaces(2).toFixed(2),
      conversion:
        input.currency === baseCurrency
          ? null
          : {
              from: input.currency,
              to: baseCurrency,
              rate: initialInBase.rate,
              date: initialInBase.date,
            },
      impact: { level, ...copy },
      disclaimer:
        "Esta comparación no reserva dinero ni modifica saldos. Solo contrasta la simulación con la situación financiera actual de Fynar.",
    };
  }

  async purchase(workspaceId: string, baseCurrency: string, timezone: string, userId: string, input: PurchaseSimulationInput, now = new Date()) {
    const forecast = await this.forecasts.monthEnd(workspaceId, baseCurrency, timezone, userId, now);
    const primary = forecast.primary;
    const beforeClosing = Number(primary.projectedClosingBalance);
    const beforeLowest = Number(primary.lowestProjectedBalance.amount);

    const account = input.accountId ? await this.accounts.find(workspaceId, input.accountId) : null;
    if (input.accountId && !account) throw new AppError("Cuenta no encontrada para la simulación", { status: 404, code: "SIMULATION_ACCOUNT_NOT_FOUND", publicMessage: "La cuenta seleccionada ya no está disponible" });
    if (input.paymentMethod === "CASH" && account?.nature !== "ASSET") throw new AppError("La compra de contado requiere una cuenta de activo", { status: 400, code: "SIMULATION_INVALID_CASH_ACCOUNT", publicMessage: "Selecciona una cuenta con dinero disponible" });
    if (input.paymentMethod === "CREDIT_CARD" && account?.type !== "CREDIT_CARD") throw new AppError("La simulación con tarjeta requiere una tarjeta de crédito", { status: 400, code: "SIMULATION_INVALID_CARD", publicMessage: "Selecciona una tarjeta de crédito válida" });

    const rate = input.monthlyRate ?? 0;
    const monthlyPayment = input.paymentMethod === "CASH" ? input.amount : fixedPayment(input.amount, input.installments, rate);
    const totalCost = input.paymentMethod === "CASH" ? input.amount : monthlyPayment * input.installments;
    const estimatedInterest = Math.max(0, totalCost - input.amount);
    const periodImpact = input.paymentMethod === "CASH" ? input.amount : monthlyPayment;
    const afterClosing = beforeClosing - periodImpact;
    const lowestAfter = beforeLowest - periodImpact;
    const level = impactLevel(beforeClosing, afterClosing, lowestAfter);
    const copy = impactCopy(level);

    const accountAfter = !account ? null : input.paymentMethod === "CASH"
      ? Number(account.currentBalance) - input.amount
      : account.type === "CREDIT_CARD" && account.creditLimit
        ? Number(account.creditLimit) - Number(account.currentBalance) - input.amount
        : null;

    const relevantBudgets = input.categoryId
      ? await this.budgets.list(workspaceId, timezone, {
          includeArchived: "false",
          status: "ACTIVE",
          currency: baseCurrency,
          categoryId: input.categoryId,
          ...(input.accountId ? { accountId: input.accountId } : {}),
          dateFrom: forecast.period.dateFrom,
          dateTo: forecast.period.dateTo,
          page: 1,
          limit: 100,
        })
      : { items: [] };

    const budgetImpact = relevantBudgets.items.map((budget) => {
      const spentBefore = Number(budget.progress.spent);
      const amount = Number(budget.amount);
      const spentAfter = spentBefore + input.amount;
      const percentageAfter = amount > 0 ? (spentAfter / amount) * 100 : 0;
      return {
        id: budget.id,
        name: budget.name,
        amount: budget.amount,
        spentBefore: budget.progress.spent,
        spentAfter: money(spentAfter),
        remainingAfter: money(amount - spentAfter),
        percentageAfter: money(percentageAfter),
        statusAfter: spentAfter > amount ? "EXCEEDED" : percentageAfter >= Number(budget.alertThreshold) ? "WARNING" : "SAFE",
      };
    });

    return {
      purchase: { name: input.name ?? null, amount: money(input.amount), paymentMethod: input.paymentMethod, categoryId: input.categoryId ?? null, account: account ? { id: account.id, name: account.name, type: account.type, currency: account.currency } : null },
      before: { currentAvailable: primary.currentAvailable, projectedClosingBalance: primary.projectedClosingBalance, lowestProjectedBalance: primary.lowestProjectedBalance, knownCommitments: primary.knownCommitments },
      after: { projectedClosingBalance: money(afterClosing), lowestProjectedBalance: { ...primary.lowestProjectedBalance, amount: money(lowestAfter) }, addedCommitmentThisPeriod: money(periodImpact), selectedAccountAfter: accountAfter === null ? null : money(accountAfter) },
      financing: input.paymentMethod === "CASH" ? null : {
        installments: input.installments,
        monthlyRate: rate,
        monthlyPayment: money(monthlyPayment),
        estimatedInterest: money(estimatedInterest),
        totalCost: money(totalCost),
        schedule: financingSchedule(now, input.installments, monthlyPayment),
      },
      budgets: budgetImpact,
      impact: { level, ...copy },
      period: forecast.period,
      currency: primary.currency,
      assumptions: [
        "La simulación usa la proyección de cierre vigente de Fynar.",
        input.paymentMethod === "CASH" ? "La compra de contado se descuenta completa del periodo actual." : "El impacto inmediato usa la primera cuota y el cronograma muestra los compromisos futuros estimados.",
        input.categoryId ? "El impacto presupuestario supone que la compra pertenece a la categoría seleccionada." : "Sin categoría no se atribuye la compra a un presupuesto específico.",
        "No se crean movimientos, deudas, compras, pagos ni cambios de saldo al simular.",
      ],
    };
  }
}

export const simulationsService = new SimulationsService();
