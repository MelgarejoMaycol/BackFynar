import { Prisma, type PrismaClient } from "@prisma/client";

export const isRetryableTransactionError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || typeof error.meta !== "object" || error.meta === null) return false;
  const databaseCode = "code" in error.meta ? error.meta.code : undefined;
  return databaseCode === "40001" || databaseCode === "40P01";
};

type TxCallback<T> = (tx: Prisma.TransactionClient) => Promise<T>;

export async function withTransactionRetry<T>(operation: () => Promise<T>): Promise<T>;
export async function withTransactionRetry<T>(db: PrismaClient, operation: TxCallback<T>): Promise<T>;
export async function withTransactionRetry<T>(
  operationOrDb: (() => Promise<T>) | PrismaClient,
  transactionOperation?: TxCallback<T>,
): Promise<T> {
  const operation =
    typeof operationOrDb === "function"
      ? operationOrDb
      : () => operationOrDb.$transaction((tx) => transactionOperation!(tx));
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isRetryableTransactionError(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}
