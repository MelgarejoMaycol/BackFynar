import { account_nature, account_type, Prisma } from "@prisma/client";
import { AppError, ConflictError } from "../../common/errors/app-error.js";
import { accountsRepository, type AccountsRepository } from "./accounts.repository.js";
import { toPublicAccount, type AccountRecord } from "./accounts.mapper.js";
import type {
  CreateAccountInput,
  ListAccountsInput,
  UpdateAccountInput,
} from "./accounts.schemas.js";

const accountNotFound = () =>
  new AppError("Cuenta no encontrada en el workspace", {
    status: 404,
    code: "ACCOUNT_NOT_FOUND",
    publicMessage: "Cuenta no encontrada",
  });
const assetTypes = new Set<account_type>(["CASH", "CHECKING", "SAVINGS", "E_WALLET", "INVESTMENT"]);
const liabilityTypes = new Set<account_type>(["CREDIT_CARD", "LOAN"]);

interface CoherentAccount {
  type: account_type;
  nature: account_nature;
  creditLimit?: string | null | undefined;
  billingDay?: number | null | undefined;
  paymentDueDay?: number | null | undefined;
}
export function validateAccountCoherence(account: CoherentAccount): void {
  if (assetTypes.has(account.type) && account.nature !== "ASSET")
    throw new ConflictError("Tipo incompatible con naturaleza", "Tipo y naturaleza incompatibles");
  if (liabilityTypes.has(account.type) && account.nature !== "LIABILITY")
    throw new ConflictError("Tipo incompatible con naturaleza", "Tipo y naturaleza incompatibles");
  if (
    account.type !== "CREDIT_CARD" &&
    [account.creditLimit, account.billingDay, account.paymentDueDay].some((value) => value != null)
  )
    throw new ConflictError(
      "Campos de tarjeta en cuenta incompatible",
      "Campos incompatibles con el tipo de cuenta",
    );
}
const money = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const isUniqueConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const duplicateAccountName = () =>
  new ConflictError(
    "Nombre de cuenta duplicado dentro del workspace",
    "Ya existe una cuenta con ese nombre. Restaure la cuenta anterior o utilice otro nombre.",
  );

export class AccountsService {
  constructor(private readonly repository: AccountsRepository = accountsRepository) {}
  async create(workspaceId: string, input: CreateAccountInput) {
    validateAccountCoherence(input);
    const openingBalance = money(input.openingBalance);
    try {
      return toPublicAccount(
        await this.repository.create(workspaceId, {
          name: input.name,
          type: input.type,
          nature: input.nature,
          currency: input.currency,
          openingBalance,
          currentBalance: openingBalance,
          ...(input.institutionName !== undefined
            ? { institutionName: input.institutionName }
            : {}),
          ...(input.creditLimit !== undefined
            ? { creditLimit: input.creditLimit === null ? null : money(input.creditLimit) }
            : {}),
          ...(input.billingDay !== undefined ? { billingDay: input.billingDay } : {}),
          ...(input.paymentDueDay !== undefined ? { paymentDueDay: input.paymentDueDay } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.includeInNetWorth !== undefined
            ? { includeInNetWorth: input.includeInNetWorth }
            : {}),
          ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        }),
      );
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw duplicateAccountName();
      throw error;
    }
  }
  async list(workspaceId: string, filters: ListAccountsInput) {
    return (await this.repository.list(workspaceId, filters)).map(toPublicAccount);
  }
  async get(workspaceId: string, accountId: string) {
    const account = await this.repository.find(workspaceId, accountId);
    if (!account) throw accountNotFound();
    return toPublicAccount(account);
  }
  async update(workspaceId: string, accountId: string, input: UpdateAccountInput) {
    try {
      const updated = await this.repository.mutate(workspaceId, accountId, (current) => {
        if (!current) throw accountNotFound();
        const merged: CoherentAccount = {
          type: input.type ?? current.type,
          nature: input.nature ?? current.nature,
          creditLimit:
            input.creditLimit !== undefined
              ? input.creditLimit
              : (current.creditLimit?.toFixed(2) ?? null),
          billingDay: input.billingDay !== undefined ? input.billingDay : current.billingDay,
          paymentDueDay:
            input.paymentDueDay !== undefined ? input.paymentDueDay : current.paymentDueDay,
        };
        validateAccountCoherence(merged);
        return {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.nature !== undefined ? { nature: input.nature } : {}),
          ...(input.institutionName !== undefined
            ? { institutionName: input.institutionName }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.creditLimit !== undefined
            ? { creditLimit: input.creditLimit === null ? null : money(input.creditLimit) }
            : {}),
          ...(input.billingDay !== undefined ? { billingDay: input.billingDay } : {}),
          ...(input.paymentDueDay !== undefined ? { paymentDueDay: input.paymentDueDay } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.includeInNetWorth !== undefined
            ? { includeInNetWorth: input.includeInNetWorth }
            : {}),
          ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        };
      });
      if (!updated) throw accountNotFound();
      return toPublicAccount(updated);
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw duplicateAccountName();
      throw error;
    }
  }
  async favorite(workspaceId: string, accountId: string, isFavorite: boolean) {
    return this.mutateState(workspaceId, accountId, { isFavorite });
  }
  async archive(workspaceId: string, accountId: string) {
    return this.mutateState(workspaceId, accountId, { isActive: false });
  }
  async restore(workspaceId: string, accountId: string) {
    return this.mutateState(workspaceId, accountId, { isActive: true });
  }
  private async mutateState(
    workspaceId: string,
    accountId: string,
    data: Prisma.FinancialAccountUpdateManyMutationInput,
  ) {
    const updated = await this.repository.mutate(workspaceId, accountId, () => data);
    if (!updated) throw accountNotFound();
    return toPublicAccount(updated);
  }
  async remove(workspaceId: string, userId: string, accountId: string) {
    const result = await this.repository.removeSafely(workspaceId, userId, accountId);
    if (!result) throw accountNotFound();
    return result;
  }
}

export const accountsService = new AccountsService();
export type { AccountRecord };
