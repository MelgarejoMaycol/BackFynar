import { CreditMathError } from "./credit-math.error.js";

const validDate = (date: Date): void => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw new CreditMathError("INVALID_DATE");
};

const daysInUtcMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/** Adds calendar months while preserving the original contractual day where possible. */
export function addContractMonths(firstDate: Date, months: number): Date {
  validDate(firstDate);
  if (!Number.isInteger(months) || months < 0) throw new CreditMathError("INVALID_TERM");
  const contractualDay = firstDate.getUTCDate();
  const absoluteMonth = firstDate.getUTCFullYear() * 12 + firstDate.getUTCMonth() + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth % 12;
  return new Date(Date.UTC(year, month, Math.min(contractualDay, daysInUtcMonth(year, month))));
}

export function calculateEstimatedEndDate(firstPaymentDate: Date, installments: number): Date {
  if (!Number.isInteger(installments) || installments <= 0)
    throw new CreditMathError("INVALID_TERM");
  return addContractMonths(firstPaymentDate, installments - 1);
}
