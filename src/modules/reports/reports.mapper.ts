import { Prisma } from "@prisma/client";
export const reportFixed = (v: Prisma.Decimal) => v.toDecimalPlaces(2).toFixed(2);
export const reportPercentage = (v: Prisma.Decimal, total: Prisma.Decimal) =>
  total.isZero() ? "0.00" : reportFixed(v.div(total).mul(100));
export const reportChange = (current: Prisma.Decimal, previous: Prisma.Decimal) => {
  const amount = current.minus(previous);
  return {
    amount: reportFixed(amount),
    percentage: previous.isZero() ? null : reportFixed(amount.div(previous.abs()).mul(100)),
  };
};
