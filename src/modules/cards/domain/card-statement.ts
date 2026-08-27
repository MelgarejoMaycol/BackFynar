import { Prisma } from "@prisma/client";

export const calculateCardStatementBalance = (input: {
  previousBalance: Prisma.Decimal;
  purchases: Prisma.Decimal;
  payments: Prisma.Decimal;
  interest: Prisma.Decimal;
  fees: Prisma.Decimal;
}) =>
  input.previousBalance
    .plus(input.purchases)
    .minus(input.payments)
    .plus(input.interest)
    .plus(input.fees);
