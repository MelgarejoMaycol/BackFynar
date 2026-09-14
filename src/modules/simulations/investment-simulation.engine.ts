import { Prisma } from "@prisma/client";

export type InvestmentContributionFrequency = "NONE" | "MONTHLY" | "QUARTERLY" | "YEARLY";

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
const TWELVE = D(12);

const fixedMoney = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const fixedRate = (value: Prisma.Decimal) => value.toDecimalPlaces(8).toFixed(8);
const fixedPercent = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);

const contributionInterval = (frequency: InvestmentContributionFrequency): number | null => {
  if (frequency === "MONTHLY") return 1;
  if (frequency === "QUARTERLY") return 3;
  if (frequency === "YEARLY") return 12;
  return null;
};

export function simulateInvestment(input: InvestmentSimulationInput) {
  const initialAmount = D(input.initialAmount);
  const recurringContribution = D(input.recurringContribution);
  const annualReturn = D(input.annualReturn);
  const annualFee = D(input.annualFee);
  const inflationRate = D(input.inflationRate);
  const months = input.years * 12;

  const grossMonthlyFactor = ONE.plus(annualReturn).pow(ONE.div(TWELVE));
  const feeMonthlyFactor = ONE.minus(annualFee).pow(ONE.div(TWELVE));
  const monthlyGrowthFactor = grossMonthlyFactor.mul(feeMonthlyFactor);
  const effectiveMonthlyReturn = monthlyGrowthFactor.minus(ONE);
  const effectiveAnnualReturn = monthlyGrowthFactor.pow(12).minus(ONE);
  const interval = contributionInterval(input.contributionFrequency);

  let balance = initialAmount;
  let totalContributions = initialAmount;
  const timeline = [
    {
      month: 0,
      year: 0,
      contributed: fixedMoney(totalContributions),
      estimatedValue: fixedMoney(balance),
      estimatedProfit: "0.00",
    },
  ];

  for (let month = 1; month <= months; month += 1) {
    balance = balance.mul(monthlyGrowthFactor);
    if (interval && month % interval === 0 && recurringContribution.gt(0)) {
      balance = balance.plus(recurringContribution);
      totalContributions = totalContributions.plus(recurringContribution);
    }

    timeline.push({
      month,
      year: Number((month / 12).toFixed(4)),
      contributed: fixedMoney(totalContributions),
      estimatedValue: fixedMoney(balance),
      estimatedProfit: fixedMoney(balance.minus(totalContributions)),
    });
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
      "La simulación capitaliza el rendimiento mensualmente.",
      "Los aportes periódicos se agregan al final de cada periodo configurado.",
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
