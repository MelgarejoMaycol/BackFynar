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

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateLendingSchedule(input: {
  principal: number;
  ratePercent: number;
  termCount: number;
  method: LendingMethod;
}): LendingScheduleRow[] {
  const { principal, ratePercent, termCount, method } = input;
  if (!Number.isFinite(principal) || principal <= 0) throw new Error("El capital debe ser mayor que cero");
  if (!Number.isFinite(ratePercent) || ratePercent < 0) throw new Error("La tasa no puede ser negativa");
  if (!Number.isInteger(termCount) || termCount < 1 || termCount > 600) throw new Error("El plazo no es válido");

  const rate = ratePercent / 100;
  const fixedPayment = rate === 0
    ? principal / termCount
    : principal * (rate / (1 - Math.pow(1 + rate, -termCount)));
  const fixedPrincipal = principal / termCount;
  const rows: LendingScheduleRow[] = [];
  let balance = principal;

  for (let index = 1; index <= termCount; index += 1) {
    const opening = balance;
    const interest = roundMoney(opening * rate);
    let principalPart: number;
    if (method === "INTEREST_ONLY") principalPart = index === termCount ? opening : 0;
    else if (method === "FIXED_PRINCIPAL") principalPart = Math.min(opening, roundMoney(fixedPrincipal));
    else principalPart = Math.min(opening, roundMoney(fixedPayment - interest));
    if (index === termCount) principalPart = opening;
    const total = roundMoney(principalPart + interest);
    balance = roundMoney(Math.max(0, opening - principalPart));
    rows.push({
      installmentNumber: index,
      openingPrincipal: roundMoney(opening),
      principalAmount: roundMoney(principalPart),
      interestAmount: interest,
      totalAmount: total,
      closingPrincipal: balance,
    });
  }
  return rows;
}

export function summarizeLendingSchedule(rows: LendingScheduleRow[]) {
  const totalPrincipal = roundMoney(rows.reduce((sum, row) => sum + row.principalAmount, 0));
  const totalInterest = roundMoney(rows.reduce((sum, row) => sum + row.interestAmount, 0));
  return {
    installmentAmount: rows[0]?.totalAmount ?? 0,
    totalPrincipal,
    totalInterest,
    totalReceivable: roundMoney(totalPrincipal + totalInterest),
  };
}

export function addFrequency(date: Date, frequency: LendingFrequency, count = 1) {
  const next = new Date(date);
  if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7 * count);
  else if (frequency === "BIWEEKLY") next.setUTCDate(next.getUTCDate() + 14 * count);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}
