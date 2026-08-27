import { Prisma } from "@prisma/client";
import { addContractPeriods } from "./credit-calendar.js";
import { CreditMathError } from "./credit-math.error.js";
import type {
  AmortizationInstallment,
  AmortizationScheduleInput,
  CreditTotals,
  DecimalInput,
  FixedPaymentInput,
  InstallmentCalculation,
  InstallmentCalculationInput,
  InterestRateBasis,
  PaymentFrequency,
} from "./credit-math.types.js";

export const MONEY_SCALE = 2;
export const RATE_SCALE = 12;
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;
const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const TWELVE = new Prisma.Decimal(12);

const decimal = (
  value: DecimalInput,
  code: "INVALID_PRINCIPAL" | "INVALID_RATE" | "INVALID_PAYMENT" | "INVALID_AMOUNT",
) => {
  if (typeof value === "number" && !Number.isFinite(value)) throw new CreditMathError(code);
  try {
    const parsed = new Prisma.Decimal(value);
    if (!parsed.isFinite()) throw new CreditMathError(code);
    return parsed;
  } catch (error: unknown) {
    if (error instanceof CreditMathError) throw error;
    throw new CreditMathError(code);
  }
};
const money = (value: Prisma.Decimal): Prisma.Decimal =>
  value.toDecimalPlaces(MONEY_SCALE, ROUNDING).isZero()
    ? new Prisma.Decimal(0)
    : value.toDecimalPlaces(MONEY_SCALE, ROUNDING);
const rate = (value: Prisma.Decimal): Prisma.Decimal => value.toDecimalPlaces(RATE_SCALE, ROUNDING);
const term = (value: number): void => {
  if (!Number.isInteger(value) || value <= 0) throw new CreditMathError("INVALID_TERM");
};
const nonNegativeRate = (value: DecimalInput): Prisma.Decimal => {
  const parsed = decimal(value, "INVALID_RATE");
  if (parsed.isNegative()) throw new CreditMathError("INVALID_RATE");
  return parsed;
};
const positive = (value: DecimalInput, code: "INVALID_PRINCIPAL" | "INVALID_PAYMENT") => {
  const parsed = decimal(value, code);
  if (parsed.lte(ZERO)) throw new CreditMathError(code);
  return parsed;
};
const optionalCost = (value: DecimalInput | undefined): Prisma.Decimal => {
  const parsed = decimal(value ?? 0, "INVALID_AMOUNT");
  if (parsed.isNegative()) throw new CreditMathError("INVALID_AMOUNT");
  return money(parsed);
};

export const roundMoney = (value: DecimalInput): Prisma.Decimal =>
  money(decimal(value, "INVALID_AMOUNT"));
export const roundRate = (value: DecimalInput): Prisma.Decimal => rate(nonNegativeRate(value));

/** Nominal annual assumes twelve monthly capitalization periods. */
export function toEffectiveMonthly(value: DecimalInput, basis: InterestRateBasis): Prisma.Decimal {
  const input = nonNegativeRate(value);
  if (input.isZero()) return ZERO;
  switch (basis) {
    case "EFFECTIVE_ANNUAL":
      return rate(ONE.plus(input).pow(ONE.div(TWELVE)).minus(ONE));
    case "NOMINAL_ANNUAL":
      return rate(input.div(TWELVE));
    case "EFFECTIVE_MONTHLY":
    case "NOMINAL_MONTHLY":
      return rate(input);
  }
}

export function toEffectivePeriodic(
  value: DecimalInput,
  basis: InterestRateBasis,
  frequency: PaymentFrequency,
): Prisma.Decimal {
  const monthly = toEffectiveMonthly(value, basis);
  if (monthly.isZero() || frequency === "MONTHLY") return monthly;
  if (frequency === "BIMONTHLY") return rate(ONE.plus(monthly).pow(2).minus(ONE));
  if (frequency === "SEMIANNUAL") return rate(ONE.plus(monthly).pow(6).minus(ONE));
  return rate(ONE.plus(monthly).pow(TWELVE.div(52)).minus(ONE));
}

export function effectivePeriodicToMonthly(
  value: DecimalInput,
  frequency: PaymentFrequency,
): Prisma.Decimal {
  const periodic = nonNegativeRate(value);
  if (periodic.isZero() || frequency === "MONTHLY") return rate(periodic);
  if (frequency === "BIMONTHLY") return rate(ONE.plus(periodic).pow(ONE.div(2)).minus(ONE));
  if (frequency === "SEMIANNUAL") return rate(ONE.plus(periodic).pow(ONE.div(6)).minus(ONE));
  return rate(ONE.plus(periodic).pow(new Prisma.Decimal(52).div(TWELVE)).minus(ONE));
}

export function convertInterestRate(
  value: DecimalInput,
  from: InterestRateBasis,
  to: InterestRateBasis,
): Prisma.Decimal {
  const monthly = toEffectiveMonthly(value, from);
  switch (to) {
    case "EFFECTIVE_ANNUAL":
      return rate(ONE.plus(monthly).pow(12).minus(ONE));
    case "NOMINAL_ANNUAL":
      return rate(monthly.mul(TWELVE));
    case "EFFECTIVE_MONTHLY":
    case "NOMINAL_MONTHLY":
      return monthly;
  }
}

export function calculateFixedPayment(input: FixedPaymentInput): Prisma.Decimal {
  const principal = positive(input.principal, "INVALID_PRINCIPAL");
  const periodicRate = nonNegativeRate(input.periodicRate);
  term(input.numberOfInstallments);
  if (periodicRate.isZero()) return money(principal.div(input.numberOfInstallments));
  const factor = ONE.plus(periodicRate).pow(input.numberOfInstallments);
  return money(principal.mul(periodicRate).mul(factor).div(factor.minus(ONE)));
}

export function calculateInstallment(input: InstallmentCalculationInput): InstallmentCalculation {
  const opening = positive(input.openingBalance, "INVALID_PRINCIPAL");
  const periodicRate = nonNegativeRate(input.periodicRate);
  const requestedPayment = positive(input.paymentAmount, "INVALID_PAYMENT");
  const interestAmount = money(opening.mul(periodicRate));
  if (!input.finalInstallment && requestedPayment.lte(interestAmount))
    throw new CreditMathError("PAYMENT_TOO_LOW");
  const paymentAmount = input.finalInstallment
    ? money(opening.plus(interestAmount))
    : money(Prisma.Decimal.min(requestedPayment, opening.plus(interestAmount)));
  const principalAmount = money(Prisma.Decimal.min(opening, paymentAmount.minus(interestAmount)));
  const closingBalance = money(Prisma.Decimal.max(ZERO, opening.minus(principalAmount)));
  return { interestAmount, principalAmount, paymentAmount, closingBalance };
}

export function generateAmortizationSchedule(
  input: AmortizationScheduleInput,
): AmortizationInstallment[] {
  const principal = positive(input.principal, "INVALID_PRINCIPAL");
  const periodicRate = nonNegativeRate(input.periodicRate);
  term(input.numberOfInstallments);
  if (
    !(input.firstPaymentDate instanceof Date) ||
    !Number.isFinite(input.firstPaymentDate.getTime())
  )
    throw new CreditMathError("INVALID_DATE");
  const regularPayment =
    input.paymentAmount === undefined
      ? calculateFixedPayment(input)
      : money(positive(input.paymentAmount, "INVALID_PAYMENT"));
  const insuranceAmount = optionalCost(input.insuranceAmount);
  const feeAmount = optionalCost(input.feeAmount);
  if (regularPayment.lte(money(principal.mul(periodicRate))))
    throw new CreditMathError("PAYMENT_TOO_LOW");

  const schedule: AmortizationInstallment[] = [];
  let balance = money(principal);
  for (let index = 0; index < input.numberOfInstallments; index += 1) {
    const installment = calculateInstallment({
      openingBalance: balance,
      periodicRate,
      paymentAmount: regularPayment,
      finalInstallment: index === input.numberOfInstallments - 1,
    });
    schedule.push({
      installmentNumber: index + 1,
      dueDate: addContractPeriods(
        input.firstPaymentDate,
        index,
        input.paymentFrequency ?? "MONTHLY",
      ),
      openingBalance: balance,
      principalAmount: installment.principalAmount,
      interestAmount: installment.interestAmount,
      insuranceAmount,
      feeAmount,
      paymentAmount: money(installment.paymentAmount.plus(insuranceAmount).plus(feeAmount)),
      closingBalance: installment.closingBalance,
    });
    balance = installment.closingBalance;
  }
  return schedule;
}

const paidCount = (schedule: readonly AmortizationInstallment[], paymentsMade: number): number => {
  if (!Number.isInteger(paymentsMade) || paymentsMade < 0 || paymentsMade > schedule.length)
    throw new CreditMathError("INVALID_TERM");
  return paymentsMade;
};
const sum = (values: readonly Prisma.Decimal[]): Prisma.Decimal =>
  money(values.reduce((total, value) => total.plus(value), ZERO));

export function calculateRemainingBalance(
  schedule: readonly AmortizationInstallment[],
  paymentsMade: number,
) {
  const count = paidCount(schedule, paymentsMade);
  return count === 0 ? (schedule[0]?.openingBalance ?? ZERO) : schedule[count - 1]!.closingBalance;
}
export function calculatePaidPrincipal(
  schedule: readonly AmortizationInstallment[],
  paymentsMade: number,
) {
  return sum(
    schedule.slice(0, paidCount(schedule, paymentsMade)).map((row) => row.principalAmount),
  );
}
export function calculatePaidInterest(
  schedule: readonly AmortizationInstallment[],
  paymentsMade: number,
) {
  return sum(schedule.slice(0, paidCount(schedule, paymentsMade)).map((row) => row.interestAmount));
}
export function calculateRemainingInterest(
  schedule: readonly AmortizationInstallment[],
  paymentsMade: number,
) {
  return sum(schedule.slice(paidCount(schedule, paymentsMade)).map((row) => row.interestAmount));
}
export function calculateRemainingInstallments(
  schedule: readonly AmortizationInstallment[],
  paymentsMade: number,
) {
  return schedule.length - paidCount(schedule, paymentsMade);
}
export function calculateTotalCost(schedule: readonly AmortizationInstallment[]): CreditTotals {
  const totalPrincipal = sum(schedule.map((row) => row.principalAmount));
  const totalInterest = sum(schedule.map((row) => row.interestAmount));
  const totalInsurance = sum(schedule.map((row) => row.insuranceAmount));
  const totalFees = sum(schedule.map((row) => row.feeAmount));
  return {
    totalPrincipal,
    totalInterest,
    totalInsurance,
    totalFees,
    totalCost: money(totalPrincipal.plus(totalInterest).plus(totalInsurance).plus(totalFees)),
  };
}

export function calculateNumberOfPeriods(
  balanceInput: DecimalInput,
  periodicRateInput: DecimalInput,
  paymentInput: DecimalInput,
  maximumPeriods = 100_000,
): number {
  let balance = money(positive(balanceInput, "INVALID_PRINCIPAL"));
  const periodicRate = nonNegativeRate(periodicRateInput);
  const payment = money(positive(paymentInput, "INVALID_PAYMENT"));
  if (!Number.isInteger(maximumPeriods) || maximumPeriods <= 0)
    throw new CreditMathError("INVALID_TERM");
  if (payment.lte(money(balance.mul(periodicRate)))) throw new CreditMathError("PAYMENT_TOO_LOW");
  for (let period = 1; period <= maximumPeriods; period += 1) {
    balance = calculateInstallment({
      openingBalance: balance,
      periodicRate,
      paymentAmount: payment,
    }).closingBalance;
    if (balance.isZero()) return period;
  }
  throw new CreditMathError("CALCULATION_NOT_POSSIBLE");
}
