import { Prisma } from "@prisma/client";

const DAYS_PER_MONTH = 365.2425 / 12;
const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

export interface ProjectionContribution {
  amount: Prisma.Decimal;
  contributedAt: Date;
}

export const calculateGoalProjection = (input: {
  targetAmount: Prisma.Decimal;
  savedAmount: Prisma.Decimal;
  targetDate: Date | null;
  contributions: ProjectionContribution[];
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  const remaining = Prisma.Decimal.max(input.targetAmount.minus(input.savedAmount), 0);
  const surplus = Prisma.Decimal.max(input.savedAmount.minus(input.targetAmount), 0);
  const rawPercentage = input.savedAmount.div(input.targetAmount).mul(100);
  const percentage = Prisma.Decimal.min(Prisma.Decimal.max(rawPercentage, 0), 100);

  let suggestedMonthlyAmount: string | null = null;
  if (input.targetDate && remaining.gt(0)) {
    const targetEnd = new Date(`${dateOnly(input.targetDate)}T23:59:59.999Z`);
    const daysRemaining = Math.max((targetEnd.getTime() - now.getTime()) / 86_400_000, 0);
    if (daysRemaining > 0) {
      const monthsRemaining = Math.max(daysRemaining / DAYS_PER_MONTH, 1 / DAYS_PER_MONTH);
      suggestedMonthlyAmount = fixed(remaining.div(monthsRemaining));
    }
  }

  const ordered = [...input.contributions].sort(
    (left, right) => left.contributedAt.getTime() - right.contributedAt.getTime(),
  );
  const first = ordered[0];
  const last = ordered.at(-1);
  const spanDays =
    first && last ? (last.contributedAt.getTime() - first.contributedAt.getTime()) / 86_400_000 : 0;
  const netContributed = ordered.reduce(
    (total, item) => total.plus(item.amount),
    new Prisma.Decimal(0),
  );

  let averageMonthlyContribution: string | null = null;
  let estimatedCompletionDate: string | null = null;
  let estimationReason: "COMPLETED" | "INSUFFICIENT_HISTORY" | "NON_POSITIVE_PACE" | "ESTIMATED";

  if (remaining.eq(0)) {
    estimationReason = "COMPLETED";
    estimatedCompletionDate = dateOnly(now);
  } else if (ordered.length < 2 || spanDays < 30) {
    estimationReason = "INSUFFICIENT_HISTORY";
  } else {
    const monthsObserved = Math.max(spanDays / DAYS_PER_MONTH, 1);
    const pace = netContributed.div(monthsObserved);
    if (pace.lte(0)) {
      estimationReason = "NON_POSITIVE_PACE";
    } else {
      averageMonthlyContribution = fixed(pace);
      const monthsToGoal = remaining.div(pace).toNumber();
      const completion = new Date(now.getTime() + monthsToGoal * DAYS_PER_MONTH * 86_400_000);
      estimatedCompletionDate = dateOnly(completion);
      estimationReason = "ESTIMATED";
    }
  }

  return {
    savedAmount: fixed(input.savedAmount),
    targetAmount: fixed(input.targetAmount),
    remainingAmount: fixed(remaining),
    surplusAmount: fixed(surplus),
    percentage: fixed(percentage),
    suggestedMonthlyAmount,
    averageMonthlyContribution,
    estimatedCompletionDate,
    estimationReason,
  };
};
