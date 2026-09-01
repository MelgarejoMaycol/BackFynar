import {
  Prisma,
  type account_nature,
  type category_type,
  type transaction_type,
} from "@prisma/client";
import { AppError, ConflictError } from "../../common/errors/app-error.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import { toPublicTransaction, transactionSelect } from "./transactions.mapper.js";
import { transactionsRepository, type TransactionsRepository } from "./transactions.repository.js";
import type {
  ListTransactionsInput,
  AdjustmentInput,
  MovementInput,
  TransferInput,
  UpdateTransactionInput,
} from "./transactions.schemas.js";
import {
  removeCardPurchaseTracking,
  synchronizeCardPurchase,
} from "../cards/domain/card-purchase.js";

const notFound = () =>
  new AppError("Movimiento no encontrado", {
    status: 404,
    code: "TRANSACTION_NOT_FOUND",
    publicMessage: "Movimiento no encontrado",
  });
const versionConflict = () =>
  new ConflictError(
    "Versión de movimiento obsoleta",
    "El movimiento fue modificado por otra solicitud. Actualice los datos e intente nuevamente.",
  );
const unsupportedFinancialType = () =>
  new ConflictError(
    "Tipo de movimiento sin semántica financiera implementada",
    "El tipo de movimiento todavía no admite modificaciones financieras.",
  );
type SupportedFinancialType = Extract<transaction_type, "INCOME" | "EXPENSE" | "TRANSFER">;
function assertSupportedFinancialType(
  type: transaction_type,
): asserts type is SupportedFinancialType {
  if (type !== "INCOME" && type !== "EXPENSE" && type !== "TRANSFER")
    throw unsupportedFinancialType();
}
const decimal = (value: string) => new Prisma.Decimal(value);
type Tx = Prisma.TransactionClient;
export const balanceDeltas = (
  type: SupportedFinancialType,
  amount: Prisma.Decimal,
  sourceNature: account_nature,
  destinationNature?: account_nature,
) => {
  const sourceDelta =
    type === "INCOME"
      ? sourceNature === "ASSET"
        ? amount
        : amount.negated()
      : sourceNature === "ASSET"
        ? amount.negated()
        : amount;
  const destinationDelta =
    type === "TRANSFER" ? (destinationNature === "LIABILITY" ? amount.negated() : amount) : null;
  return { sourceDelta, destinationDelta };
};
export const assertLiabilityPaymentWithinBalance = (
  amount: Prisma.Decimal,
  currentBalance: Prisma.Decimal,
) => {
  if (amount.gt(currentBalance))
    throw new ConflictError(
      "Pago superior al saldo pendiente",
      "El pago no puede superar el saldo pendiente de la tarjeta o crédito.",
    );
};
export const assertSufficientTransferFunds = (
  amount: Prisma.Decimal,
  currentBalance: Prisma.Decimal,
) => {
  if (amount.gt(currentBalance))
    throw new ConflictError(
      "Fondos insuficientes",
      "No tienes saldo suficiente en la cuenta de origen para realizar esta transferencia.",
    );
};
export const assertCardPurchaseWithinLimit = (
  amount: Prisma.Decimal,
  currentBalance: Prisma.Decimal,
  creditLimit: Prisma.Decimal | null,
  currency = "COP",
) => {
  if (!creditLimit) return;
  const available = Prisma.Decimal.max(0, creditLimit.minus(currentBalance));
  if (amount.gt(available))
    throw new ConflictError(
      "Cupo insuficiente",
      `No tienes cupo suficiente. Disponible: ${new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      })
        .format(available.toNumber())
        .replace(/\s/g, " ")}.`,
    );
};
export class TransactionsService {
  constructor(private readonly repository: TransactionsRepository = transactionsRepository) {}
  async list(workspaceId: string, filters: ListTransactionsInput) {
    const [rows, total] = await this.repository.list(workspaceId, filters);
    const hasMore = !filters.page && rows.length > filters.limit;
    const page = rows.slice(0, filters.limit);
    const last = page.at(-1);
    return {
      items: page.map(toPublicTransaction),
      limit: filters.limit,
      total,
      page: filters.page ?? 1,
      totalPages: Math.ceil(total / filters.limit),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                occurredAt: last.occurredAt,
                createdAt: last.createdAt,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  }
  async get(workspaceId: string, id: string) {
    const row = await this.repository.find(workspaceId, id);
    if (!row) throw notFound();
    return toPublicTransaction(row);
  }
  private async resources(
    tx: Tx,
    workspaceId: string,
    type: transaction_type,
    accountId: string,
    destinationId: string | null,
    categoryId: string | undefined,
  ) {
    const ids = [accountId, ...(destinationId ? [destinationId] : [])];
    await this.repository.lockAccounts(tx, ids);
    const accounts = await tx.financialAccount.findMany({
      where: { id: { in: ids }, workspaceId, isActive: true, deletedAt: null },
    });
    if (accounts.length !== ids.length)
      throw new AppError("Cuenta ajena, archivada o inexistente", {
        status: 404,
        code: "ACCOUNT_NOT_FOUND",
        publicMessage: "Cuenta no encontrada",
      });
    const source = accounts.find((a) => a.id === accountId)!;
    const destination = destinationId ? accounts.find((a) => a.id === destinationId)! : null;
    if (type === "INCOME" && source.nature !== "ASSET" && source.type !== "CREDIT_CARD")
      throw new ConflictError(
        "Ingreso en pasivo no soportado",
        "Los ingresos directos solo pueden aplicarse a activos o tarjetas de crédito",
      );
    if (type === "TRANSFER" && source.nature !== "ASSET")
      throw new ConflictError(
        "Transferencia genérica desde pasivo no soportada",
        "Los avances de tarjetas deben registrarse desde el flujo especializado de tarjetas.",
      );
    if (
      type === "TRANSFER" &&
      destination?.nature === "LIABILITY" &&
      destination.type !== "CREDIT_CARD"
    )
      throw new ConflictError(
        "Pago genérico de crédito no soportado",
        "Los pagos de créditos deben registrarse desde el cronograma del crédito.",
      );
    if (destination && source.currency !== destination.currency)
      throw new ConflictError(
        "Monedas incompatibles",
        "Las transferencias requieren cuentas con la misma moneda",
      );
    const categoryOptional = type === "INCOME" && source.type === "CREDIT_CARD";
    const category = categoryId
      ? await tx.category.findFirst({
          where: {
            id: categoryId,
            type: type as category_type,
            isActive: true,
            deletedAt: null,
            OR: [
              { workspaceId: null, isSystem: true },
              { workspaceId, isSystem: false },
            ],
          },
        })
      : null;
    if ((!categoryId && !categoryOptional) || (categoryId && !category))
      throw new AppError("Categoría ajena, archivada o incompatible", {
        status: 404,
        code: "CATEGORY_NOT_FOUND",
        publicMessage: "Categoría no encontrada",
      });
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return {
      source,
      destination,
      currency: source.currency,
      timezone: workspace?.timezone ?? "UTC",
    };
  }
  private async effect(
    tx: Tx,
    type: transaction_type,
    accountId: string,
    destinationId: string | null,
    amount: Prisma.Decimal,
    direction: 1 | -1,
  ) {
    assertSupportedFinancialType(type);
    const signed = direction === 1 ? amount : amount.negated();
    const accounts = await tx.financialAccount.findMany({
      where: { id: { in: [accountId, ...(destinationId ? [destinationId] : [])] } },
      select: {
        id: true,
        nature: true,
        currentBalance: true,
        type: true,
        creditLimit: true,
        currency: true,
      },
    });
    const source = accounts.find((account) => account.id === accountId)!;
    const destination = destinationId
      ? accounts.find((account) => account.id === destinationId)!
      : null;
    const { sourceDelta, destinationDelta } = balanceDeltas(
      type,
      signed,
      source.nature,
      destination?.nature,
    );
    if (direction === 1 && type === "INCOME" && source.nature === "LIABILITY")
      assertLiabilityPaymentWithinBalance(amount, source.currentBalance);
    if (direction === 1 && type === "TRANSFER" && destination?.nature === "LIABILITY")
      assertLiabilityPaymentWithinBalance(amount, destination.currentBalance);
    if (direction === 1 && type === "TRANSFER" && source.nature === "ASSET")
      assertSufficientTransferFunds(amount, source.currentBalance);
    if (direction === 1 && type === "EXPENSE" && source.type === "CREDIT_CARD")
      assertCardPurchaseWithinLimit(
        amount,
        source.currentBalance,
        source.creditLimit,
        source.currency,
      );
    if (
      direction === 1 &&
      type === "TRANSFER" &&
      source.nature === "ASSET" &&
      amount.gt(source.currentBalance)
    )
      throw new ConflictError(
        "Fondos insuficientes",
        "No tienes saldo suficiente en la cuenta de origen para realizar esta transferencia.",
      );
    await tx.financialAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: sourceDelta } },
    });
    if (destinationDelta && destinationId)
      await tx.financialAccount.update({
        where: { id: destinationId },
        data: { currentBalance: { increment: destinationDelta } },
      });
  }
  private async create(
    workspaceId: string,
    userId: string,
    type: "INCOME" | "EXPENSE" | "TRANSFER",
    input: MovementInput | TransferInput,
  ) {
    return this.repository.transaction(async (tx) => {
      const destination =
        type === "TRANSFER" ? (input as TransferInput).destinationAccountId : null;
      const resources = await this.resources(
        tx,
        workspaceId,
        type,
        input.accountId,
        destination,
        input.categoryId,
      );
      const amount = decimal(input.amount);
      await this.effect(tx, type, input.accountId, destination, amount, 1);
      const transaction = await tx.transaction.create({
        data: {
          workspaceId,
          createdBy: userId,
          type,
          status: "CONFIRMED",
          amount,
          currency: resources.currency,
          accountId: input.accountId,
          destinationAccountId: destination,
          categoryId: input.categoryId ?? null,
          occurredAt: new Date(input.occurredAt),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.merchantName !== undefined ? { merchantName: input.merchantName } : {}),
          ...(type === "EXPENSE" && resources.source.type === "CREDIT_CARD"
            ? { metadata: { cardPurchase: true } }
            : {}),
        },
        select: transactionSelect,
      });
      if (type === "EXPENSE" && resources.source.type === "CREDIT_CARD") {
        const details = "cardPurchase" in input ? input.cardPurchase : undefined;
        await synchronizeCardPurchase(tx, {
          workspaceId,
          cardAccountId: resources.source.id,
          transactionId: transaction.id,
          amount,
          occurredAt: new Date(input.occurredAt),
          ...(details?.installmentCount !== undefined
            ? { installmentCount: details.installmentCount }
            : {}),
          ...(details?.periodicRate
            ? { periodicRate: decimal(details.periodicRate) }
            : resources.source.referencePeriodicRate
              ? { periodicRate: resources.source.referencePeriodicRate }
              : {}),
          rateSource: details?.periodicRate
            ? "INFORMED"
            : resources.source.referenceRateSource === "INFORMED"
              ? "INFORMED"
              : "ESTIMATED",
          ...(details?.firstDueDate
            ? { firstDueDate: new Date(`${details.firstDueDate}T00:00:00Z`) }
            : {}),
          paymentDueDay: resources.source.paymentDueDay,
          timezone: resources.timezone,
        });
      }
      return toPublicTransaction(transaction);
    });
  }
  income(w: string, u: string, i: MovementInput) {
    return this.create(w, u, "INCOME", i);
  }
  expense(w: string, u: string, i: MovementInput) {
    return this.create(w, u, "EXPENSE", i);
  }
  transfer(w: string, u: string, i: TransferInput) {
    return this.create(w, u, "TRANSFER", i);
  }
  async adjustment(workspaceId: string, userId: string, input: AdjustmentInput) {
    return this.repository.transaction(async (tx) => {
      await this.repository.lockAccounts(tx, [input.accountId]);
      const account = await tx.financialAccount.findFirst({
        where: { id: input.accountId, workspaceId, isActive: true, deletedAt: null },
      });
      if (!account)
        throw new AppError("Cuenta no encontrada", { status: 404, code: "ACCOUNT_NOT_FOUND" });
      const actualBalance = decimal(input.actualBalance);
      const difference = actualBalance.minus(account.currentBalance);
      if (difference.isZero())
        throw new ConflictError(
          "El saldo ya coincide",
          "El saldo indicado ya coincide con el registrado.",
        );
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { currentBalance: { increment: difference } },
      });
      return toPublicTransaction(
        await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type: "ADJUSTMENT",
            status: "CONFIRMED",
            amount: difference.abs(),
            currency: account.currency,
            accountId: account.id,
            occurredAt: new Date(input.occurredAt),
            description: input.description ?? "Ajuste manual de saldo",
            metadata: {
              difference: difference.toFixed(2),
              previousBalance: account.currentBalance.toFixed(2),
              actualBalance: actualBalance.toFixed(2),
            },
          },
          select: transactionSelect,
        }),
      );
    });
  }
  async update(workspaceId: string, id: string, input: UpdateTransactionInput) {
    return this.repository.transaction(async (tx) => {
      const current = await this.repository.lockTransaction(tx, id, workspaceId);
      if (!current) throw notFound();
      const obligationPayment = await tx.obligationPayment.findUnique({
        where: { transactionId: id },
        select: { id: true, occurrence: { select: { obligationId: true } } },
      });
      if (obligationPayment)
        throw new ConflictError(
          "Movimiento protegido por pago de obligación",
          "Este movimiento fue generado por un pago de obligación. Edita el pago original para conservar saldos y estado sincronizados.",
        );
      assertSupportedFinancialType(current.type);
      if (current.version !== input.version) throw versionConflict();
      if (current.status !== "CONFIRMED")
        throw new ConflictError("Movimiento cancelado", "No puede editar un movimiento cancelado");
      const existingPurchase = await tx.cardPurchase.findUnique({
        where: { transactionId: id },
      });
      const accountId = input.accountId ?? current.accountId!;
      const destination =
        input.destinationAccountId !== undefined
          ? input.destinationAccountId
          : current.destinationAccountId;
      if (current.type === "TRANSFER" && !destination)
        throw new ConflictError("Transferencia sin destino");
      if (current.type !== "TRANSFER" && destination)
        throw new ConflictError("Destino incompatible");
      if (accountId === destination) throw new ConflictError("Transferencia a la misma cuenta");
      await this.repository.lockAccounts(tx, [
        current.accountId!,
        ...(current.destinationAccountId ? [current.destinationAccountId] : []),
        accountId,
        ...(destination ? [destination] : []),
      ]);
      await this.effect(
        tx,
        current.type,
        current.accountId!,
        current.destinationAccountId,
        current.amount,
        -1,
      );
      const resources = await this.resources(
        tx,
        workspaceId,
        current.type,
        accountId,
        destination,
        input.categoryId ?? current.categoryId!,
      );
      const amount = input.amount ? decimal(input.amount) : current.amount;
      await this.effect(tx, current.type, accountId, destination, amount, 1);
      const result = await tx.transaction.updateMany({
        where: { id, workspaceId, version: input.version, status: "CONFIRMED", deletedAt: null },
        data: {
          accountId,
          destinationAccountId: destination,
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.amount !== undefined ? { amount } : {}),
          currency: resources.currency,
          ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.merchantName !== undefined ? { merchantName: input.merchantName } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw versionConflict();
      const updated = (await this.repository.find(workspaceId, id, tx))!;
      if (current.type === "EXPENSE" && resources.source.type === "CREDIT_CARD") {
        const details = input.cardPurchase === null ? undefined : input.cardPurchase;
        await synchronizeCardPurchase(tx, {
          workspaceId,
          cardAccountId: accountId,
          transactionId: id,
          amount,
          occurredAt: updated.occurredAt,
          installmentCount: details?.installmentCount ?? existingPurchase?.installmentCount ?? 1,
          ...(details?.periodicRate
            ? { periodicRate: decimal(details.periodicRate) }
            : existingPurchase?.periodicRate
              ? { periodicRate: existingPurchase.periodicRate }
              : {}),
          ...(details?.firstDueDate
            ? { firstDueDate: new Date(`${details.firstDueDate}T00:00:00Z`) }
            : {}),
          paymentDueDay: resources.source.paymentDueDay,
          timezone: resources.timezone,
        });
      } else if (existingPurchase) {
        await removeCardPurchaseTracking(tx, id);
      }
      return toPublicTransaction(updated);
    });
  }
  async cancel(workspaceId: string, userId: string, id: string, version: number) {
    return this.repository.transaction(async (tx) => {
      const current = await this.repository.lockTransaction(tx, id, workspaceId);
      if (!current) throw notFound();
      const obligationPayment = await tx.obligationPayment.findUnique({
        where: { transactionId: id },
        select: { id: true },
      });
      if (obligationPayment)
        throw new ConflictError(
          "Movimiento protegido por pago de obligación",
          "Este movimiento pertenece a un pago de obligación. Reviértelo desde la obligación para conservar el historial y los saldos.",
        );
      assertSupportedFinancialType(current.type);
      if (current.status === "CANCELLED") return { mode: "CANCELLED" as const };
      if (current.version !== version) throw versionConflict();
      await this.repository.lockAccounts(tx, [
        current.accountId!,
        ...(current.destinationAccountId ? [current.destinationAccountId] : []),
      ]);
      await this.effect(
        tx,
        current.type,
        current.accountId!,
        current.destinationAccountId,
        current.amount,
        -1,
      );
      await removeCardPurchaseTracking(tx, id);
      const result = await tx.transaction.updateMany({
        where: { id, workspaceId, version, status: "CONFIRMED", deletedAt: null },
        data: { status: "CANCELLED", deletedAt: new Date(), version: { increment: 1 } },
      });
      if (result.count !== 1) throw versionConflict();
      await recordDeletionAudit(tx, {
        workspaceId,
        userId,
        entityType: "TRANSACTION",
        entityId: id,
        mode: "CANCELLED",
        name: current.description,
      });
      return { mode: "CANCELLED" as const };
    });
  }
}
export const transactionsService = new TransactionsService();
