const datePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
};

export const validDayOfMonth = (year: number, month: number, requestedDay: number): number =>
  Math.min(requestedDay, new Date(Date.UTC(year, month, 0)).getUTCDate());

const occurrence = (year: number, month: number, requestedDay: number): Date =>
  new Date(Date.UTC(year, month - 1, validDayOfMonth(year, month, requestedDay)));

export const nextMonthlyDate = (
  reference: Date,
  requestedDay: number,
  timeZone: string,
): Date => {
  const local = datePartsInTimeZone(reference, timeZone);
  const current = occurrence(local.year, local.month, requestedDay);
  const today = occurrence(local.year, local.month, local.day);
  if (current.getTime() >= today.getTime()) return current;
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  return occurrence(nextYear, nextMonth, requestedDay);
};

export const cardCycleDates = (
  reference: Date,
  billingDay: number | null,
  paymentDueDay: number | null,
  timeZone: string,
) => ({
  nextBillingDate: billingDay ? nextMonthlyDate(reference, billingDay, timeZone) : null,
  nextPaymentDate: paymentDueDay ? nextMonthlyDate(reference, paymentDueDay, timeZone) : null,
});
