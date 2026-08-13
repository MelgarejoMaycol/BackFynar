import { Prisma } from "@prisma/client";
import { CreditMathError } from "./credit-math.error.js";
import { calculateFixedPayment, roundMoney, roundRate } from "./credit-math.js";
import type { PeriodicRateSolverInput } from "./credit-estimation.types.js";

export const DEFAULT_RATE_TOLERANCE = new Prisma.Decimal("0.000000000001");
export const DEFAULT_MONEY_TOLERANCE = new Prisma.Decimal("0.01");
export const DEFAULT_MAX_RATE_ITERATIONS = 200;
export const DEFAULT_MAX_PERIODIC_RATE = new Prisma.Decimal("1000");

const positive = (
  value: PeriodicRateSolverInput["principal"],
  code: "INVALID_PRINCIPAL" | "INVALID_PAYMENT",
) => {
  if (typeof value === "number" && !Number.isFinite(value)) throw new CreditMathError(code);
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
  } catch {
    throw new CreditMathError(code);
  }
  if (!parsed.isFinite() || parsed.lte(0)) throw new CreditMathError(code);
  return parsed;
};

/** Deterministic bisection over non-negative periodic rates. */
export function solvePeriodicRate(input: PeriodicRateSolverInput): Prisma.Decimal {
  const principal = positive(input.principal, "INVALID_PRINCIPAL");
  const payment = roundMoney(positive(input.paymentAmount, "INVALID_PAYMENT"));
  if (!Number.isInteger(input.numberOfInstallments) || input.numberOfInstallments <= 0)
    throw new CreditMathError("INVALID_TERM");
  const zeroPayment = calculateFixedPayment({
    principal,
    periodicRate: 0,
    numberOfInstallments: input.numberOfInstallments,
  });
  const moneyTolerance = roundMoney(input.moneyTolerance ?? DEFAULT_MONEY_TOLERANCE);
  if (payment.lt(zeroPayment.minus(moneyTolerance))) throw new CreditMathError("RATE_NOT_SOLVABLE");
  if (payment.minus(zeroPayment).abs().lte(moneyTolerance)) return new Prisma.Decimal(0);
  const rateTolerance = new Prisma.Decimal(input.rateTolerance ?? DEFAULT_RATE_TOLERANCE);
  const maximumRate = new Prisma.Decimal(input.maximumRate ?? DEFAULT_MAX_PERIODIC_RATE);
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_RATE_ITERATIONS;
  if (
    rateTolerance.lte(0) ||
    maximumRate.lte(0) ||
    !Number.isInteger(maxIterations) ||
    maxIterations <= 0
  )
    throw new CreditMathError("CALCULATION_NOT_POSSIBLE");

  let low = new Prisma.Decimal(0);
  let high = new Prisma.Decimal(1);
  while (
    calculateFixedPayment({
      principal,
      periodicRate: high,
      numberOfInstallments: input.numberOfInstallments,
    }).lt(payment)
  ) {
    high = high.mul(2);
    if (high.gt(maximumRate)) throw new CreditMathError("RATE_NOT_SOLVABLE");
  }
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const middle = low.plus(high).div(2);
    const calculated = calculateFixedPayment({
      principal,
      periodicRate: middle,
      numberOfInstallments: input.numberOfInstallments,
    });
    if (calculated.minus(payment).abs().lte(moneyTolerance) || high.minus(low).lte(rateTolerance))
      return roundRate(middle);
    if (calculated.lt(payment)) low = middle;
    else high = middle;
  }
  throw new CreditMathError("CALCULATION_NOT_POSSIBLE");
}
