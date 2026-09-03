import { Prisma, type goal_status } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { AppError, ConflictError, ValidationError } from "../../common/errors/app-error.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import { calculateGoalProjection } from "./goals.projection.js";
import {
  attachContributionToAccount,
  contributionAllocation,
  contributionAllocations,
  reservationsByAccount,
  reservedForGoalAccount,
} from "./goals.reservations.js";
import type {
  CreateContributionInput,
  CreateGoalInput,
  ListGoalsInput,
  UpdateGoalInput,
} from "./goals.schemas.js";

const notFound = () =>
  new AppError("Meta de ahorro no encontrada", {
    status: 404,
    code: "SAVINGS_GOAL_NOT_FOUND",
    publicMessage: "Meta de ahorro no encontrada",
  });

const contributionNotFound = () =>
  new AppError("Aporte no encontrado", {
    status: 404,
    code: "GOAL_CONTRIBUTION_NOT_FOUND",
    publicMessage: "Aporte no encontrado",
  });

const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

const goalSelect = Prisma.validator<Prisma.SavingsGoalSelect>()({
  id: true,
  workspaceId: true,
  accountId: true,
  name: true,
  targetAmount: true,
  savedAmount: true,
  targetDate: true,
  status: true,
  icon: true,
  color: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  financialAccounts: {
    select: { id: true, name: true, type: true, nature: true, currency: true, isActive: true },
  },
  goalContributions: {
    select: {
      id: true,
      transactionId: true,
      amount: true,
      contributedAt: true,
      createdAt: true,
    },
    orderBy: [{ contributedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  },
});

type GoalRecord = Prisma.SavingsGoalGetPayload<{ select: typeof goalSelect }>;
type Database = typeof prisma;

type AllocationMap = Map<
  string,
  { accountId: string; accountName: string; currency: string }
>;

export class GoalsService {
  constructor(private readonly database: Database = prisma) {}

  private find(workspaceId: string, goalId: string, client: Prisma.TransactionClient | Database = this.database) {
    return client.savingsGoal.findFirst({ where: { id: goalId, workspaceId }, select: goalSelect });
  }

  private async requireGoal(
    workspaceId: string,
    goalId: string,
    client: Prisma.TransactionClient | Database = this.database,
  ) {
    const goal = await this.find(workspaceId, goalId, client);
    if (!goal) throw notFound();
    return goal;
  }

  private async validateAccount(
    client: Prisma.TransactionClient,
    workspaceId: string,
    accountId: string | null | undefined,
  ) {
    if (!accountId) return null;
    const account = await client.financialAccount.findFirst({
      where: { id: accountId, workspaceId, isActive: true, deletedAt: null, nature: "ASSET" },
      select: { id: true, name: true, currency: true, currentBalance: true },
    });
    if (!account)
      throw new AppError("Cuenta no disponible", {
        status: 404,
        code: "ACCOUNT_NOT_FOUND",
        publicMessage: "Selecciona una cuenta activa de dinero del mismo espacio",
      });
    return account;
  }

  private publicGoal(goal: GoalRecord, allocations: AllocationMap = new Map(), now = new Date()) {
    const projection = calculateGoalProjection({
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      targetDate: goal.targetDate,
      contributions: goal.goalContributions.map(({ amount, contributedAt }) => ({ amount, contributedAt })),
      now,
    });
    return {
      id: goal.id,
      name: goal.name,
      targetAmount: fixed(goal.targetAmount),
      savedAmount: fixed(goal.savedAmount),
      targetDate: dateOnly(goal.targetDate),
      status: goal.status,
      icon: goal.icon,
      color: goal.color,
      account: goal.financialAccounts
        ? { ...goal.financialAccounts, currency: goal.financialAccounts.currency.trim() }
        : null,
      progress: projection,
      contributions: goal.goalContributions.map((entry) => {
        const allocation = allocations.get(entry.id);
        return {
          id: entry.id,
          transactionId: entry.transactionId,
          accountId: allocation?.accountId ?? null,
          account: allocation
            ? {
                id: allocation.accountId,
                name: allocation.accountName,
                currency: allocation.currency,
              }
            : null,
          amount: fixed(entry.amount),
          direction: entry.amount.isNegative() ? "OUT" : "IN",
          contributedAt: entry.contributedAt.toISOString(),
          createdAt: entry.createdAt.toISOString(),
        };
      }),
      archivedAt: goal.deletedAt?.toISOString() ?? null,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    };
  }

  private async allocationMap(workspaceId: string, goals: GoalRecord[]) {
    const ids = goals.flatMap((goal) => goal.goalContributions.map((entry) => entry.id));
    const rows = await contributionAllocations(this.database, workspaceId, ids);
    return new Map(
      rows.map((row) => [
        row.contributionId,
        { accountId: row.accountId, accountName: row.accountName, currency: row.currency },
      ]),
    );
  }

  async list(workspaceId: string, filters: ListGoalsInput) {
    const where: Prisma.SavingsGoalWhereInput = {
      workspaceId,
      ...(filters.includeArchived === "true" ? {} : { deletedAt: null }),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };
    const [items, total] = await Promise.all([
      this.database.savingsGoal.findMany({
        where,
        select: goalSelect,
        orderBy: [{ status: "asc" }, { targetDate: "asc" }, { createdAt: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.database.savingsGoal.count({ where }),
    ]);
    const allocations = await this.allocationMap(workspaceId, items);
    return {
      items: items.map((goal) => this.publicGoal(goal, allocations)),
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async get(workspaceId: string, goalId: string) {
    const goal = await this.requireGoal(workspaceId, goalId);
    return this.publicGoal(goal, await this.allocationMap(workspaceId, [goal]));
  }

  async projection(workspaceId: string, goalId: string) {
    return (await this.get(workspaceId, goalId)).progress;
  }

  async create(workspaceId: string, input: CreateGoalInput) {
    const id = await this.database.$transaction(async (tx) => {
      await this.validateAccount(tx, workspaceId, input.accountId);
      return (
        await tx.savingsGoal.create({
          data: {
            workspaceId,
            name: input.name,
            targetAmount: new Prisma.Decimal(input.targetAmount),
            targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null,
            accountId: input.accountId ?? null,
            icon: input.icon ?? null,
            color: input.color ?? null,
          },
          select: { id: true },
        })
      ).id;
    });
    return this.get(workspaceId, id);
  }

  async update(workspaceId: string, goalId: string, input: UpdateGoalInput) {
    await this.database.$transaction(async (tx) => {
      const current = await this.requireGoal(workspaceId, goalId, tx);
      if (current.deletedAt) throw new ConflictError("Meta archivada", "Restaure la meta antes de editarla");
      if (input.accountId !== undefined) await this.validateAccount(tx, workspaceId, input.accountId);
      const targetAmount = input.targetAmount ? new Prisma.Decimal(input.targetAmount) : current.targetAmount;
      const nextStatus: goal_status = current.savedAmount.gte(targetAmount)
        ? "COMPLETED"
        : current.status === "COMPLETED"
          ? "ACTIVE"
          : current.status;
      await tx.savingsGoal.update({
        where: { id: goalId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.targetAmount !== undefined ? { targetAmount } : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null }
            : {}),
          ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          status: nextStatus,
        },
      });
    });
    return this.get(workspaceId, goalId);
  }

  async setStatus(workspaceId: string, goalId: string, status: "ACTIVE" | "PAUSED" | "COMPLETED") {
    await this.database.$transaction(async (tx) => {
      const current = await this.requireGoal(workspaceId, goalId, tx);
      if (current.deletedAt) throw new ConflictError("Meta archivada", "Restaure la meta antes de cambiar su estado");
      if (status === "COMPLETED" && current.savedAmount.lt(current.targetAmount))
        throw new ValidationError("No puede completar una meta antes de alcanzar el valor objetivo");
      await tx.savingsGoal.update({ where: { id: goalId }, data: { status } });
    });
    return this.get(workspaceId, goalId);
  }

  async archive(workspaceId: string, userId: string, goalId: string) {
    return this.database.$transaction(async (tx) => {
      const current = await this.requireGoal(workspaceId, goalId, tx);
      if (current.deletedAt) throw notFound();
      await recordDeletionAudit(tx, {
        workspaceId,
        userId,
        entityType: "SAVINGS_GOAL",
        entityId: goalId,
        mode: "LOGICAL",
        name: current.name,
      });
      await tx.savingsGoal.update({ where: { id: goalId }, data: { deletedAt: new Date(), status: "CANCELLED" } });
      return { mode: "LOGICAL" as const };
    });
  }

  async restore(workspaceId: string, goalId: string) {
    await this.database.$transaction(async (tx) => {
      const current = await this.requireGoal(workspaceId, goalId, tx);
      if (!current.deletedAt) return;
      await this.validateAccount(tx, workspaceId, current.accountId);
      await tx.savingsGoal.update({
        where: { id: goalId },
        data: {
          deletedAt: null,
          status: current.savedAmount.gte(current.targetAmount) ? "COMPLETED" : "ACTIVE",
        },
      });
    });
    return this.get(workspaceId, goalId);
  }

  private async refreshSavedAmount(tx: Prisma.TransactionClient, goal: GoalRecord) {
    const aggregate = await tx.goalContribution.aggregate({ where: { goalId: goal.id }, _sum: { amount: true } });
    const saved = aggregate._sum.amount ?? new Prisma.Decimal(0);
    if (saved.lt(0)) throw new ConflictError("Saldo de meta inválido", "La meta no puede tener ahorro negativo");
    const status: goal_status = saved.gte(goal.targetAmount)
      ? "COMPLETED"
      : goal.status === "COMPLETED"
        ? "ACTIVE"
        : goal.status;
    await tx.savingsGoal.update({ where: { id: goal.id }, data: { savedAmount: saved, status } });
  }

  private async ensureCanReserve(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    accountId: string,
    amount: Prisma.Decimal,
  ) {
    const account = await this.validateAccount(tx, workspaceId, accountId);
    if (!account) throw new ValidationError("Selecciona la cuenta de la cual se hará el aporte");
    const reservations = await reservationsByAccount(tx, workspaceId);
    const reserved = reservations.find((item) => item.accountId === accountId)?.reservedForGoals ?? new Prisma.Decimal(0);
    const available = account.currentBalance.minus(reserved);
    if (amount.gt(available))
      throw new ValidationError(
        `El aporte supera el disponible de ${account.name}. Disponible para metas: ${fixed(Prisma.Decimal.max(available, 0))}`,
      );
  }

  async addContribution(workspaceId: string, userId: string, goalId: string, input: CreateContributionInput) {
    await this.database.$transaction(async (tx) => {
      const goal = await this.requireGoal(workspaceId, goalId, tx);
      if (goal.deletedAt) throw new ConflictError("Meta archivada", "Restaure la meta antes de registrar aportes");
      const amount = new Prisma.Decimal(input.amount);
      if (amount.gt(0) && goal.status === "PAUSED")
        throw new ConflictError("Meta pausada", "Reactive la meta antes de registrar nuevos aportes");

      if (amount.gt(0)) {
        await this.ensureCanReserve(tx, workspaceId, input.accountId, amount);
      } else {
        const reservedInAccount = await reservedForGoalAccount(tx, goalId, input.accountId);
        if (amount.abs().gt(reservedInAccount))
          throw new ValidationError("El retiro no puede superar lo reservado para esta meta en la cuenta seleccionada");
      }

      const contribution = await tx.goalContribution.create({
        data: {
          goalId,
          transactionId: null,
          amount,
          contributedAt: input.contributedAt ? new Date(input.contributedAt) : new Date(),
        },
        select: { id: true },
      });
      await attachContributionToAccount(tx, {
        contributionId: contribution.id,
        workspaceId,
        accountId: input.accountId,
      });
      await this.refreshSavedAmount(tx, goal);
      await tx.auditLog.create({
        data: {
          workspaceId,
          userId,
          entityType: "GOAL_CONTRIBUTION",
          entityId: contribution.id,
          action: amount.isNegative() ? "WITHDRAW" : "CONTRIBUTE",
          newData: { goalId, amount: fixed(amount), accountId: input.accountId, reservationOnly: true },
        },
      });
    });
    return this.get(workspaceId, goalId);
  }

  async reverseContribution(workspaceId: string, userId: string, goalId: string, contributionId: string) {
    await this.database.$transaction(async (tx) => {
      const goal = await this.requireGoal(workspaceId, goalId, tx);
      if (goal.deletedAt) throw new ConflictError("Meta archivada", "Restaure la meta antes de corregir aportes");
      const contribution = await tx.goalContribution.findFirst({
        where: { id: contributionId, goalId },
        select: { id: true, amount: true, transactionId: true, contributedAt: true },
      });
      if (!contribution) throw contributionNotFound();
      const allocation = await contributionAllocation(tx, workspaceId, contributionId);
      if (!allocation)
        throw new ConflictError("Aporte sin cuenta atribuida", "Este aporte antiguo no tiene una cuenta atribuida y requiere corrección manual");
      const previousReversal = await tx.auditLog.findFirst({
        where: { workspaceId, entityType: "GOAL_CONTRIBUTION", entityId: contributionId, action: "REVERSE" },
        select: { id: true },
      });
      if (previousReversal) throw new ConflictError("Aporte ya revertido", "Este aporte ya fue revertido");

      const compensatingAmount = contribution.amount.negated();
      if (compensatingAmount.lt(0) && compensatingAmount.abs().gt(goal.savedAmount))
        throw new ConflictError("No se puede revertir el aporte", "La reversión dejaría la meta con ahorro negativo");
      if (compensatingAmount.gt(0))
        await this.ensureCanReserve(tx, workspaceId, allocation.accountId, compensatingAmount);

      const compensating = await tx.goalContribution.create({
        data: { goalId, transactionId: null, amount: compensatingAmount, contributedAt: new Date() },
        select: { id: true },
      });
      await attachContributionToAccount(tx, {
        contributionId: compensating.id,
        workspaceId,
        accountId: allocation.accountId,
      });
      await this.refreshSavedAmount(tx, goal);
      await tx.auditLog.create({
        data: {
          workspaceId,
          userId,
          entityType: "GOAL_CONTRIBUTION",
          entityId: contributionId,
          action: "REVERSE",
          oldData: {
            goalId,
            amount: fixed(contribution.amount),
            accountId: allocation.accountId,
            contributedAt: contribution.contributedAt.toISOString(),
          },
          newData: {
            compensatingContributionId: compensating.id,
            amount: fixed(compensatingAmount),
            accountId: allocation.accountId,
          },
        },
      });
    });
    return this.get(workspaceId, goalId);
  }
}

export const goalsService = new GoalsService();
