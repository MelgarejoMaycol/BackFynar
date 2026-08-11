import { Prisma, type category_type, type transaction_type } from "@prisma/client";
import { AppError, ConflictError } from "../../common/errors/app-error.js";
import { toPublicTransaction, transactionSelect } from "./transactions.mapper.js";
import { transactionsRepository, type TransactionsRepository } from "./transactions.repository.js";
import type {
  ListTransactionsInput,
  AdjustmentInput,
  MovementInput,
  TransferInput,
  UpdateTransactionInput,
} from "./transactions.schemas.js";

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
export class TransactionsService {
  constructor(private readonly repository: TransactionsRepository = transactionsRepository) {}
  async list(workspaceId: string, filters: ListTransactionsInput) {
    const [rows, total] = await this.repository.list(workspaceId, filters);
    return {
      items: rows.map(toPublicTransaction),
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
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
    categoryId: string,
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
    if (type === "INCOME" && source.nature !== "ASSET")
      throw new ConflictError(
        "Ingreso en pasivo no soportado",
        "Los ingresos directos requieren una cuenta de naturaleza ASSET",
      );
    if (destination && source.currency !== destination.currency)
      throw new ConflictError(
        "Monedas incompatibles",
        "Las transferencias requieren cuentas con la misma moneda",
      );
    const expected = type as category_type;
    const category = await tx.category.findFirst({
      where: {
        id: categoryId,
        type: expected,
        isActive: true,
        deletedAt: null,
        OR: [
          { workspaceId: null, isSystem: true },
          { workspaceId, isSystem: false },
        ],
      },
    });
    if (!category)
      throw new AppError("Categoría ajena, archivada o incompatible", {
        status: 404,
        code: "CATEGORY_NOT_FOUND",
        publicMessage: "Categoría no encontrada",
      });
    return { source, destination, currency: source.currency };
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
    let sourceDelta: Prisma.Decimal;
    let destinationDelta: Prisma.Decimal | null = null;
    switch (type) {
      case "INCOME":
        sourceDelta = signed;
        break;
      case "EXPENSE":
        sourceDelta = signed.negated();
        break;
      case "TRANSFER":
        sourceDelta = signed.negated();
        destinationDelta = signed;
        break;
      default:
        throw unsupportedFinancialType();
    }
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
      return toPublicTransaction(
        await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type,
            status: "CONFIRMED",
            amount,
            currency: resources.currency,
            accountId: input.accountId,
            destinationAccountId: destination,
            categoryId: input.categoryId,
            occurredAt: new Date(input.occurredAt),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.merchantName !== undefined ? { merchantName: input.merchantName } : {}),
          },
          select: transactionSelect,
        }),
      );
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
      assertSupportedFinancialType(current.type);
      if (current.version !== input.version) throw versionConflict();
      if (current.status !== "CONFIRMED")
        throw new ConflictError("Movimiento cancelado", "No puede editar un movimiento cancelado");
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
      return toPublicTransaction((await this.repository.find(workspaceId, id, tx))!);
    });
  }
  async cancel(workspaceId: string, id: string, version: number) {
    await this.repository.transaction(async (tx) => {
      const current = await this.repository.lockTransaction(tx, id, workspaceId);
      if (!current) throw notFound();
      assertSupportedFinancialType(current.type);
      if (current.status === "CANCELLED") return;
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
      const result = await tx.transaction.updateMany({
        where: { id, workspaceId, version, status: "CONFIRMED", deletedAt: null },
        data: { status: "CANCELLED", deletedAt: new Date(), version: { increment: 1 } },
      });
      if (result.count !== 1) throw versionConflict();
    });
  }
}
export const transactionsService = new TransactionsService();
