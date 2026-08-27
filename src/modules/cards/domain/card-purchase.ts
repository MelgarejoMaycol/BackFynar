import { Prisma } from "@prisma/client";
import { generateAmortizationSchedule } from "../../debts/domain/credit-math.js";
import { nextMonthlyDate } from "./card-cycle.js";

type Tx = Prisma.TransactionClient;
type PurchaseOperation = {
  workspaceId: string;
  cardAccountId: string;
  transactionId: string;
  amount: Prisma.Decimal;
  occurredAt: Date;
  installmentCount?: number;
  periodicRate?: Prisma.Decimal;
  firstDueDate?: Date;
  paymentDueDay?: number | null;
  timezone?: string;
  rateSource?: "INFORMED" | "ESTIMATED";
};

export async function synchronizeCardPurchase(tx: Tx, input: PurchaseOperation) {
  const installmentCount = input.installmentCount ?? 1;
  const periodicRate = input.periodicRate ?? new Prisma.Decimal(0);
  const dueDate =
    input.firstDueDate ??
    nextMonthlyDate(input.occurredAt, input.paymentDueDay ?? 1, input.timezone ?? "UTC");
  const purchase = await tx.cardPurchase.upsert({
    where: { transactionId: input.transactionId },
    create: {
      workspaceId: input.workspaceId,
      cardAccountId: input.cardAccountId,
      transactionId: input.transactionId,
      installmentCount,
      periodicRate,
      outstandingBalance: input.amount,
      rateSource: input.rateSource ?? (periodicRate.gt(0) ? "INFORMED" : "ESTIMATED"),
    },
    update: {
      cardAccountId: input.cardAccountId,
      installmentCount,
      periodicRate,
      outstandingBalance: input.amount,
      rateSource: input.rateSource ?? (periodicRate.gt(0) ? "INFORMED" : "ESTIMATED"),
    },
  });
  await tx.cardPurchaseInstallment.deleteMany({ where: { cardPurchaseId: purchase.id } });
  const schedule = generateAmortizationSchedule({
    principal: input.amount,
    periodicRate,
    numberOfInstallments: installmentCount,
    firstPaymentDate: dueDate,
  });
  await tx.cardPurchaseInstallment.createMany({
    data: schedule.map((row) => ({
      workspaceId: input.workspaceId,
      cardPurchaseId: purchase.id,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate,
      principalAmount: row.principalAmount,
      interestAmount: row.interestAmount,
      totalAmount: row.paymentAmount,
    })),
  });
  return purchase;
}

export async function removeCardPurchaseTracking(tx: Tx, transactionId: string) {
  await tx.cardPurchase.deleteMany({ where: { transactionId } });
}
