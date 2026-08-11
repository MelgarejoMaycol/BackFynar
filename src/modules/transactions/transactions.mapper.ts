import { Prisma } from "@prisma/client";
export const transactionSelect = Prisma.validator<Prisma.TransactionSelect>()({
  id: true,
  type: true,
  status: true,
  amount: true,
  currency: true,
  accountId: true,
  destinationAccountId: true,
  categoryId: true,
  occurredAt: true,
  description: true,
  notes: true,
  merchantName: true,
  metadata: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});
export type TransactionRecord = Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>;
export const toPublicTransaction = (value: TransactionRecord) => ({
  ...value,
  amount: value.amount.toFixed(2),
  occurredAt: value.occurredAt.toISOString(),
  createdAt: value.createdAt.toISOString(),
  updatedAt: value.updatedAt.toISOString(),
});
