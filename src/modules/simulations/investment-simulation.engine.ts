import { Prisma } from "@prisma/client";

export type InvestmentContributionFrequency =
  | "NONE"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY";

export interface InvestmentSimulationInput {
  currency: string;
  initialAmount: string;
  recurringContribution: string;
  contributionFrequency: InvestmentContributionFrequency;
  years: number;
  annualReturn: string;
  annualFee: string;
  inflationRate: string;
}

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ONE = D(1);
const DAYS_PER_YEAR = 365;
const MONTHS_PER_YEAR = 12;

const fixedMoney = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const fixedRate = (value: Prisma.Decimal) => value.toDecimalPlaces(8).toFixed(8);
const fixedPercent = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);

const contributionEventsPerYear = (
  frequency: InvestmentContributionFrequency,
): number => {
  if (frequency === "DAILY") return 365;
  if (frequency === "WEEKLY") return 52;
  if (frequency === "MONTHLY") return 12;
  if (frequency === "QUARTERLY") return 4;
  if (frequency === "YEARLY") return 1;
  return 0;
};

const contributionEventsUntilDay = (
  day: number,
  eventsPerYear: number,
): number => Math.floor((day * eventsPerYear) / DAYS_PER_YEAR);

export function simulateInvestment(input: InvestmentSimulationInput) {
  const initialAmount = D(input.initialAmount);
  const recurringContribution = D(input.recurringContribution);
  const annualReturn = D(input.annualReturn);
  const annualFee = D(input.annualFee);
  const inflationRate = D(input.inflationRate);
  const months = input.years * MONTHS_PER_YEAR;
  const days = input.years * DAYS_PER_YEAR;

  const grossDailyFactor = ONE.plus(annualReturn).pow(ONE.div(DAYS_PER_YEAR));
  const feeDailyFactor = ONE.minus(annualFee).pow(ONE.div(DAYS_PER_YEAR));
  const dailyGrowthFactor = grossDailyFactor.mul(feeDailyFactor);
  const effectiveMonthlyReturn = dailyGrowthFactor
    .pow(DAYS_PER_YEAR / MONTHS_PER_YEAR)
    .minus(ONE);
  const effectiveAnnualReturn = dailyGrowthFactor.pow(DAYS_PER_YEAR).minus(ONE);
  const eventsPerYear = contributionEventsPerYear(input.contributionFrequency);

  let balance = initialAmount;
  let totalContributions = initialAmount;
  let nextTimelineMonth = 1;

  const timeline = [
    {
      month: 0,
      year: 0,
      contributed: fixedMoney(totalContributions),
      estimatedValue: fixedMoney(balance),
      estimatedProfit: "0.00",
    },
  ];

  for (let day = 1; day <= days; day += 1) {
    balance = balance.mul(dailyGrowthFactor);

    if (eventsPerYear > 0 && recurringContribution.gt(0)) {
      const eventsBefore = contributionEventsUntilDay(day - 1, eventsPerYear);
      const eventsNow = contributionEventsUntilDay(day, eventsPerYear);
      const newEvents = eventsNow - eventsBefore;

      if (newEvents > 0) {
        const contribution = recurringContribution.mul(newEvents);
        balance = balance.plus(contribution);
        totalContributions = totalContributions.plus(contribution);
      }
    }

    while (
      nextTimelineMonth <= months &&
      day >= Math.round((nextTimelineMonth * DAYS_PER_YEAR) / MONTHS_PER_YEAR)
    ) {
      timeline.push({
        month: nextTimelineMonth,
        year: Number((nextTimelineMonth / MONTHS_PER_YEAR).toFixed(4)),
        contributed: fixedMoney(totalContributions),
        estimatedValue: fixedMoney(balance),
        estimatedProfit: fixedMoney(balance.minus(totalContributions)),
      });
      nextTimelineMonth += 1;
    }
  }

  const estimatedProfit = balance.minus(totalContributions);
  const inflationFactor = ONE.plus(inflationRate).pow(input.years);
  const inflationAdjustedValue = inflationRate.eq(0) ? balance : balance.div(inflationFactor);
  const totalReturnPercentage = totalContributions.gt(0)
    ? estimatedProfit.div(totalContributions).mul(100)
    : D(0);

  return {
    currency: input.currency,
    initialAmount: fixedMoney(initialAmount),
    recurringContribution: fixedMoney(recurringContribution),
    contributionFrequency: input.contributionFrequency,
    years: input.years,
    annualReturn: fixedRate(annualReturn),
    annualFee: fixedRate(annualFee),
    inflationRate: fixedRate(inflationRate),
    effectiveMonthlyReturn: fixedRate(effectiveMonthlyReturn),
    effectiveAnnualReturn: fixedRate(effectiveAnnualReturn),
    totalContributions: fixedMoney(totalContributions),
    estimatedFinalValue: fixedMoney(balance),
    estimatedProfit: fixedMoney(estimatedProfit),
    inflationAdjustedValue: fixedMoney(inflationAdjustedValue),
    totalReturnPercentage: fixedPercent(totalReturnPercentage),
    timeline,
    assumptions: [
      "La rentabilidad anual se distribuye de forma equivalente a lo largo del año para modelar aportes diarios, semanales y periódicos.",
      "Los aportes periódicos se incorporan al final de cada intervalo configurado.",
      annualFee.gt(0)
        ? "La comisión anual indicada se descuenta de forma equivalente durante el periodo."
        : "No se incluyeron comisiones.",
      inflationRate.gt(0)
        ? "El valor real estimado descuenta la inflación anual indicada."
        : "No se aplicó ajuste por inflación.",
      "Los resultados son escenarios matemáticos y no garantizan rendimientos futuros.",
      "Simular no crea movimientos ni modifica cuentas, metas, presupuestos o saldos.",
    ],
  };
}
