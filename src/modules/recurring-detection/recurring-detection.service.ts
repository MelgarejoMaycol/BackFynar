import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import {
  detectRecurringPayments,
  normalizeRecurringLabel,
  type RecurringDetectionCandidate,
  type RecurringFrequency,
} from "./domain/index.js";

interface ExistingRecurringObligation {
  name: string;
  paymentAccountId: string | null;
  recurrenceRules: {
    frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    intervalValue: number;
  };
}

const frequencyContract = (
  frequency: RecurringFrequency,
): { frequency: ExistingRecurringObligation["recurrenceRules"]["frequency"]; intervalValue: number } => {
  switch (frequency) {
    case "WEEKLY":
      return { frequency: "WEEKLY", intervalValue: 1 };
    case "BIWEEKLY":
      return { frequency: "WEEKLY", intervalValue: 2 };
    case "MONTHLY":
      return { frequency: "MONTHLY", intervalValue: 1 };
    case "BIMONTHLY":
      return { frequency: "MONTHLY", intervalValue: 2 };
    case "QUARTERLY":
      return { frequency: "MONTHLY", intervalValue: 3 };
    case "YEARLY":
      return { frequency: "YEARLY", intervalValue: 1 };
  }
};

export function isCandidateAlreadyConfigured(
  candidate: RecurringDetectionCandidate,
  obligations: ExistingRecurringObligation[],
): boolean {
  const expected = frequencyContract(candidate.frequency);
  return obligations.some((obligation) => {
    if (normalizeRecurringLabel(obligation.name) !== candidate.normalizedLabel) return false;
    if (obligation.paymentAccountId && obligation.paymentAccountId !== candidate.accountId) return false;
    return (
      obligation.recurrenceRules.frequency === expected.frequency &&
      obligation.recurrenceRules.intervalValue === expected.intervalValue
    );
  });
}

export class RecurringDetectionService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async suggestions(workspaceId: string, months = 12) {
    const boundedMonths = Math.max(3, Math.min(24, Math.trunc(months)));
    const from = new Date();
    from.setUTCMonth(from.getUTCMonth() - boundedMonths);

    const [transactions, obligations] = await Promise.all([
      this.db.transaction.findMany({
        where: {
          workspaceId,
          type: "EXPENSE",
          status: { not: "CANCELLED" },
          occurredAt: { gte: from },
        },
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          occurredAt: true,
          accountId: true,
          categoryId: true,
          merchantName: true,
          description: true,
        },
      }),
      this.db.recurringObligation.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: "ACTIVE",
        },
        select: {
          name: true,
          paymentAccountId: true,
          recurrenceRules: {
            select: {
              frequency: true,
              intervalValue: true,
            },
          },
        },
      }),
    ]);

    const candidates = detectRecurringPayments(
      transactions.map((transaction) => ({
        ...transaction,
        amount: transaction.amount.toNumber(),
      })),
    );

    const suggestions = candidates.filter(
      (candidate) => !isCandidateAlreadyConfigured(candidate, obligations),
    );

    return {
      generatedAt: new Date(),
      analysisMonths: boundedMonths,
      analyzedTransactions: transactions.length,
      detectedCandidates: candidates.length,
      suggestions,
    };
  }
}

export const recurringDetectionService = new RecurringDetectionService();
