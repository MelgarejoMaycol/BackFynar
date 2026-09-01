export type LendingMethod = "FIXED_PAYMENT" | "FIXED_PRINCIPAL" | "INTEREST_ONLY";
export type LendingFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export type LendingScheduleRow = {
  installmentNumber: number;
  openingPrincipal: number;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  closingPrincipal: number;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const addFrequency = (date: Date, frequency: LendingFrequency, periods: number) => {
  const result = new Date(date);
  if (frequency === "WEEKLY") result.setUTCDate(result.getUTCDate() + periods * 7);
  if (frequency === "BIWEEKLY") result.setUTCDate(result.getUTCDate() + periods * 14);
  if (frequency === "MONTHLY") result.setUTCMonth(result.getUTCMonth() + periods);
  return result;
};

export const calculateLendingSchedule = (input: {
  principal: number;
  ratePercent: number;
  termCount: number;
  method: LendingMethod;
}) => {
  const rate = input.ratePercent / 100;
  const rows: LendingScheduleRow[] = [];
  let balance = cents(input.principal);
  const fixedPrincipal = cents(input.principal / input.termCount);
  const fixedPayment = rate === 0
    ? fixedPrincipal
    : cents((input.principal * rate) / (1 - Math.pow(1 + rate, -input.termCount)));

  for (let index = 0; index < input.termCount; index += 1) {
    const opening = balance;
    const interest = cents(opening * rate);
    const last = index === input.termCount - 1;
    let principal = 0;
    if (input.method === "FIXED_PAYMENT") principal = cents(fixedPayment - interest);
    if (input.method === "FIXED_PRINCIPAL") principal = fixedPrincipal;
    if (input.method === "INTEREST_ONLY") principal = last ? opening : 0;
    if (last || principal > opening) principal = opening;
    balance = cents(opening - principal);
    rows.push({
      installmentNumber: index + 1,
      openingPrincipal: opening,
      principalAmount: principal,
      interestAmount: interest,
      totalAmount: cents(principal + interest),
      closingPrincipal: balance,
    });
  }
  return rows;
};

export const summarizeLendingSchedule = (rows: LendingScheduleRow[]) => {
  const totalInterest = cents(rows.reduce((sum, row) => sum + row.interestAmount, 0));
  const totalReceivable = cents(rows.reduce((sum, row) => sum + row.totalAmount, 0));
  return {
    installmentAmount: rows[0]?.totalAmount ?? 0,
    totalInterest,
    totalReceivable,
  };
};
