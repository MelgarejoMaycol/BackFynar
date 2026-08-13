import { Prisma } from "@prisma/client";
import { calculateEstimatedEndDate } from "./credit-calendar.js";
import { CreditMathError } from "./credit-math.error.js";
import {
  calculateFixedPayment,
  calculateNumberOfPeriods,
  generateAmortizationSchedule,
  roundMoney,
  roundRate,
  toEffectiveMonthly,
} from "./credit-math.js";
import { solvePeriodicRate } from "./credit-rate-solver.js";
import type {
  CreditEstimationField,
  CreditEstimationInput,
  CreditEstimationResult,
  EstimatedValue,
  EstimationAssumption,
  EstimationIssue,
  EstimationQuality,
  PaymentComparison,
} from "./credit-estimation.types.js";

export const PAYMENT_ABSOLUTE_TOLERANCE = new Prisma.Decimal("0.01");
export const PAYMENT_RELATIVE_TOLERANCE = new Prisma.Decimal("0.001");
const ZERO = new Prisma.Decimal(0);

const unknown = <T>(): EstimatedValue<T> => ({
  value: null,
  source: "UNKNOWN",
  quality: "INSUFFICIENT_DATA",
  derivedFrom: [],
});
const provided = <T>(value: T, field: CreditEstimationField): EstimatedValue<T> => ({
  value,
  source: "PROVIDED",
  quality: "EXACT",
  derivedFrom: [field],
});
const derived = <T>(
  value: T,
  source: "CALCULATED" | "ESTIMATED",
  quality: EstimationQuality,
  derivedFrom: readonly CreditEstimationField[],
): EstimatedValue<T> => ({ value, source, quality, derivedFrom });
const validPositiveMoney = (
  value: CreditEstimationInput["originalPrincipal"],
  code: "INVALID_PRINCIPAL" | "INVALID_PAYMENT",
) => {
  if (value === undefined) return null;
  let parsed: Prisma.Decimal;
  try {
    parsed = roundMoney(value);
  } catch {
    throw new CreditMathError(code);
  }
  if (parsed.lte(0)) throw new CreditMathError(code);
  return parsed;
};
const validTerm = (value: number | undefined): number | null => {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) throw new CreditMathError("INVALID_TERM");
  return value;
};
const validDate = (value: Date | undefined): Date | null => {
  if (value === undefined) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new CreditMathError("INVALID_DATE");
  return new Date(value.getTime());
};
const addUnique = <T>(items: T[], value: T): void => {
  if (!items.includes(value)) items.push(value);
};

const comparePayment = (
  providedPayment: Prisma.Decimal,
  calculated: Prisma.Decimal,
): PaymentComparison => {
  const absoluteDifference = roundMoney(providedPayment.minus(calculated).abs());
  const percentageDifference = calculated.isZero()
    ? ZERO
    : providedPayment.minus(calculated).abs().div(calculated).mul(100).toDecimalPlaces(6);
  const tolerance = Prisma.Decimal.max(
    PAYMENT_ABSOLUTE_TOLERANCE,
    calculated.abs().mul(PAYMENT_RELATIVE_TOLERANCE),
  );
  return {
    provided: providedPayment,
    calculated,
    absoluteDifference,
    percentageDifference,
    consistent: absoluteDifference.lte(tolerance),
  };
};

const inferNumberOfPeriods = (
  principal: Prisma.Decimal,
  periodicRate: Prisma.Decimal,
  paymentAmount: Prisma.Decimal,
): number => {
  const periods = calculateNumberOfPeriods(principal, periodicRate, paymentAmount);
  if (periods <= 1) return periods;

  const previousPeriodPayment = calculateFixedPayment({
    principal,
    periodicRate,
    numberOfInstallments: periods - 1,
  });
  return comparePayment(paymentAmount, previousPeriodPayment).consistent ? periods - 1 : periods;
};

/**
 * Applies a bounded list of inference rules once. It never mutates input or invents dates,
 * rates, fees or market assumptions.
 */
export function estimateCredit(input: Readonly<CreditEstimationInput>): CreditEstimationResult {
  const assumptions: EstimationAssumption[] = [];
  const issues: EstimationIssue[] = [];
  const principalValue = validPositiveMoney(input.originalPrincipal, "INVALID_PRINCIPAL");
  const balanceValue = validPositiveMoney(input.currentBalance, "INVALID_PRINCIPAL");
  const paymentValue = validPositiveMoney(input.paymentAmount, "INVALID_PAYMENT");
  const totalValue = validTerm(input.totalInstallments);
  const paidValue = validTerm(input.installmentsPaid);
  const remainingValue = validTerm(input.remainingInstallments);
  const firstDate = validDate(input.firstPaymentDate);
  validDate(input.disbursementDate);
  validDate(input.currentDate);
  const suppliedEndDate = validDate(input.estimatedEndDate);

  if (totalValue === 0 || (paidValue !== null && totalValue !== null && paidValue > totalValue))
    throw new CreditMathError("INVALID_RELATIONSHIP");
  if (remainingValue !== null && totalValue !== null && remainingValue > totalValue)
    throw new CreditMathError("INVALID_RELATIONSHIP");

  const originalPrincipal = principalValue
    ? provided(principalValue, "originalPrincipal")
    : unknown<Prisma.Decimal>();
  const currentBalance = balanceValue
    ? provided(balanceValue, "currentBalance")
    : unknown<Prisma.Decimal>();
  let paymentAmount = paymentValue
    ? provided(paymentValue, "paymentAmount")
    : unknown<Prisma.Decimal>();
  let periodicRate: EstimatedValue<Prisma.Decimal> = unknown();
  let totalInstallments =
    totalValue === null ? unknown<number>() : provided(totalValue, "totalInstallments");
  const installmentsPaid =
    paidValue === null ? unknown<number>() : provided(paidValue, "installmentsPaid");
  let remainingInstallments =
    remainingValue === null ? unknown<number>() : provided(remainingValue, "remainingInstallments");
  let estimatedEndDate = suppliedEndDate
    ? provided(suppliedEndDate, "estimatedEndDate")
    : unknown<Date>();

  if (input.periodicRate !== undefined)
    periodicRate = provided(roundRate(input.periodicRate), "periodicRate");
  else if (input.interestRate !== undefined && input.interestRateBasis !== undefined) {
    periodicRate = derived(
      toEffectiveMonthly(input.interestRate, input.interestRateBasis),
      "CALCULATED",
      "EXACT",
      ["periodicRate"],
    );
    addUnique(assumptions, "MONTHLY_PAYMENT_FREQUENCY");
  } else if (input.interestRate !== undefined || input.interestRateBasis !== undefined) {
    throw new CreditMathError("INVALID_RELATIONSHIP");
  }

  if (remainingInstallments.value === null && totalValue !== null && paidValue !== null) {
    remainingInstallments = derived(totalValue - paidValue, "CALCULATED", "EXACT", [
      "totalInstallments",
      "installmentsPaid",
    ]);
  }

  if (periodicRate.value === null && principalValue && paymentValue && totalValue) {
    try {
      periodicRate = derived(
        solvePeriodicRate({
          principal: principalValue,
          paymentAmount: paymentValue,
          numberOfInstallments: totalValue,
        }),
        "ESTIMATED",
        "HIGH_ESTIMATE",
        ["originalPrincipal", "paymentAmount", "totalInstallments"],
      );
      addUnique(assumptions, "FIXED_PAYMENT_AMORTIZATION");
      addUnique(assumptions, "CONSTANT_INTEREST_RATE");
      addUnique(assumptions, "NO_UNMODELED_FEES_OR_INSURANCE");
    } catch (error: unknown) {
      if (!(error instanceof CreditMathError) || error.code !== "RATE_NOT_SOLVABLE") throw error;
      addUnique(issues, "RATE_NOT_SOLVABLE");
    }
  }

  if (
    totalInstallments.value === null &&
    periodicRate.value &&
    paymentValue &&
    (balanceValue ?? principalValue)
  ) {
    const balance = balanceValue ?? principalValue!;
    try {
      const periods = inferNumberOfPeriods(balance, periodicRate.value, paymentValue);
      const sourceField: CreditEstimationField = balanceValue
        ? "currentBalance"
        : "originalPrincipal";
      const estimated = derived(periods, "ESTIMATED", "HIGH_ESTIMATE", [
        sourceField,
        "periodicRate",
        "paymentAmount",
      ]);
      if (balanceValue) remainingInstallments = estimated;
      else totalInstallments = estimated;
      addUnique(assumptions, "FIXED_PAYMENT_AMORTIZATION");
      addUnique(assumptions, "CONSTANT_INTEREST_RATE");
      addUnique(assumptions, "NO_UNMODELED_FEES_OR_INSURANCE");
    } catch (error: unknown) {
      if (!(error instanceof CreditMathError) || error.code !== "PAYMENT_TOO_LOW") throw error;
      addUnique(issues, "PAYMENT_TOO_LOW");
    }
  }

  let paymentComparison: PaymentComparison | null = null;
  if (principalValue && periodicRate.value && totalInstallments.value) {
    const calculatedPayment = calculateFixedPayment({
      principal: principalValue,
      periodicRate: periodicRate.value,
      numberOfInstallments: totalInstallments.value,
    });
    if (paymentValue) {
      paymentComparison = comparePayment(paymentValue, calculatedPayment);
      if (!paymentComparison.consistent) addUnique(issues, "INCONSISTENT_INPUT");
    } else {
      paymentAmount = derived(
        calculatedPayment,
        "CALCULATED",
        periodicRate.source === "ESTIMATED" || totalInstallments.source === "ESTIMATED"
          ? "HIGH_ESTIMATE"
          : "EXACT",
        ["originalPrincipal", "periodicRate", "totalInstallments"],
      );
    }
  }

  if (estimatedEndDate.value === null && firstDate && totalInstallments.value) {
    estimatedEndDate = derived(
      calculateEstimatedEndDate(firstDate, totalInstallments.value),
      totalInstallments.source === "ESTIMATED" ? "ESTIMATED" : "CALCULATED",
      totalInstallments.source === "ESTIMATED" ? "HIGH_ESTIMATE" : "EXACT",
      ["firstPaymentDate", "totalInstallments"],
    );
  }

  let estimatedSchedule = null;
  if (
    principalValue &&
    periodicRate.value &&
    totalInstallments.value &&
    firstDate &&
    !issues.includes("INCONSISTENT_INPUT") &&
    !issues.includes("PAYMENT_TOO_LOW")
  ) {
    estimatedSchedule = generateAmortizationSchedule({
      principal: principalValue,
      periodicRate: periodicRate.value,
      numberOfInstallments: totalInstallments.value,
      firstPaymentDate: firstDate,
      ...(paymentValue ? { paymentAmount: paymentValue } : {}),
    });
    addUnique(assumptions, "MONTHLY_PAYMENT_FREQUENCY");
    addUnique(assumptions, "FIXED_PAYMENT_AMORTIZATION");
    addUnique(assumptions, "CONSTANT_INTEREST_RATE");
    addUnique(assumptions, "NO_UNMODELED_FEES_OR_INSURANCE");
  }

  const useful = [
    paymentAmount,
    periodicRate,
    totalInstallments,
    remainingInstallments,
    estimatedEndDate,
  ].some((field) => field.source === "CALCULATED" || field.source === "ESTIMATED");
  if (!useful && issues.length === 0) addUnique(issues, "INSUFFICIENT_DATA");
  const overallQuality: EstimationQuality =
    issues.includes("INSUFFICIENT_DATA") ||
    issues.includes("RATE_NOT_SOLVABLE") ||
    issues.includes("PAYMENT_TOO_LOW")
      ? "INSUFFICIENT_DATA"
      : issues.includes("INCONSISTENT_INPUT")
        ? "LOW_ESTIMATE"
        : [
              paymentAmount,
              periodicRate,
              totalInstallments,
              remainingInstallments,
              estimatedEndDate,
            ].some((field) => field.quality === "HIGH_ESTIMATE")
          ? "HIGH_ESTIMATE"
          : "EXACT";

  return {
    originalPrincipal,
    currentBalance,
    paymentAmount,
    periodicRate,
    totalInstallments,
    installmentsPaid,
    remainingInstallments,
    estimatedEndDate,
    paymentComparison,
    estimatedSchedule,
    assumptions,
    issues,
    overallQuality,
  };
}
