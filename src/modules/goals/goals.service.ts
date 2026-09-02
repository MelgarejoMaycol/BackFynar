import { Prisma, type goal_status } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { AppError, ConflictError, ValidationError } from "../../common/errors/app-error.js";
import { recordDeletionAudit } from "../../common/audit/deletion-audit.js";
import { calculateGoalProjection } from "./goals.projection.js";
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
    if (!accountId) return;
    const account = await client.financialAccount.findFirst({
      where: { id: accountId, workspaceId, isActive: true, deletedAt: null, nature: "ASSET" },
      select: { id: true },
    });
    if (!account)
      throw new AppError("Cuenta no disponible", {
        status: 404,
        code: "ACCOUNT_NOT_FOUND",
        publicMessage: "La cuenta asociada debe ser una cuenta activa de dinero del mismo espacio",
      });
  }

  private publicGoal(goal: GoalRecord, now = new Date()) {
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
        ? {
            ...goal.financialAccounts,
            currency: goal.financialAccounts.currency.trim(),
          }
        : null,
      progress: projection,
      contributions: goal.goalContributions.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        amount: fixed(entry.amount),
        direction: entry.amount.isNegative() ? "OUT" : "IN",
        contributedAt: entry.contributedAt.toISOString(),
        createdAt: entry.createdAt.toISOString(),
      })),
      archivedAt: goal.deletedAt?.toISOString() ?? null,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    };
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
    return {
      items: items.map((goal) => this.publicGoal(goal)),
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async get(workspaceId: string, goalId: string) {
    return this.publicGoal(await this.requireGoal(workspaceId, goalId));
  }

  async projection(workspaceId: string, goalId: string) {
    return (await this.get(workspaceId, goalId)).progress;
  }

  async create(workspaceId: string, input: CreateGoalInput) {
    const id = await this.database.$transaction(async (tx) => {
      await this.validateAccount(tx, workspaceId, input.accountId);
      const goal = await tx.savingsGoal.create({
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
      });
      return goal.id;
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
      await tx.savingsGoal.update({
        where: { id: goalId },
        data: { deletedAt: new Date(), status: "CANCELLED" },
      });
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

  private async validateLinkedTransaction(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    goal: GoalRecord,
    transactionId: string,
    amount: Prisma.Decimal,
  ) {
    if (!goal.accountId)
      throw new ValidationError("Para vincular un movimiento, la meta debe tener una cuenta asociada");
    const transaction = await tx.transaction.findFirst({
      where: { id: transactionId, workspaceId, status: "CONFIRMED", deletedAt: null },
      select: {
        id: true,
        type: true,
        amount: true,
        accountId: true,
        destinationAccountId: true,
      },
    });
    if (!transaction)
      throw new AppError("Movimiento no encontrado", {
        status: 404,
        code: "TRANSACTION_NOT_FOUND",
        publicMessage: "Movimiento no encontrado",
      });
    const creditsGoalAccount =
      (transaction.type === "INCOME" && transaction.accountId === goal.accountId) ||
      (transaction.type === "TRANSFER" && transaction.destinationAccountId === goal.accountId);
    if (!creditsGoalAccount)
      throw new ValidationError("El movimiento vinculado debe ingresar dinero a la cuenta asociada a la meta");
    const alreadyAllocated = await tx.goalContribution.aggregate({
      where: { transactionId, amount: { gt: 0 } },
      _sum: { amount: true },
    });
    const allocated = alreadyAllocated._sum.amount ?? new Prisma.Decimal(0);
    if (allocated.plus(amount).gt(transaction.amount))
      throw new ValidationError("Los aportes vinculados no pueden superar el valor del movimiento");
  }

  private async refreshSavedAmount(tx: Prisma.TransactionClient, goal: GoalRecord) {
    const aggregate = await tx.goalContribution.aggregate({
      where: { goalId: goal.id },
      _sum: { amount: true },
    });
    const saved = aggregate._sum.amount ?? new Prisma.Decimal(0);
    if (saved.lt(0)) throw new ConflictError("Saldo de meta inválido", "La meta no puede tener ahorro negativo");
    const status: goal_status =
      saved.gte(goal.targetAmount)
        ? "COMPLETED"
        : goal.status === "COMPLETED"
          ? "ACTIVE"
          : goal.status;
    await tx.savingsGoal.update({ where: { id: goal.id }, data: { savedAmount: saved, status } });
  }

  async addContribution(
    workspaceId: string,
    userId: string,
    goalId: string,
    input: CreateContributionInput,
  ) {
    await this.database.$transaction(async (tx) => {
      const goal = await this.requireGoal(workspaceId, goalId, tx);
      if (goal.deletedAt) throw new ConflictError("Meta archivada", "Restaure la meta antes de registrar aportes");
      const amount = new Prisma.Decimal(input.amount);
      if (amount.gt(0) && goal.status === "PAUSED")
        throw new ConflictError("Meta pausada", "Reactive la meta antes de registrar nuevos aportes");
      if (amount.lt(0) && amount.abs().gt(goal.savedAmount))
        throw new ValidationError("El retiro no puede superar el valor ahorrado en la meta");
      if (amount.lt(0) && input.transactionId)
        throw new ValidationError("Un retiro de asignación no puede vincularse a un movimiento de ingreso");
      if (amount.gt(0) && input.transactionId)
        await this.validateLinkedTransaction(tx, workspaceId, goal, input.transactionId, amount);
      const contribution = await tx.goalContribution.create({
        data: {
          goalId,
          transactionId: input.transactionId ?? null,
          amount,
          contributedAt: input.contributedAt ? new Date(input.contributedAt) : new Date(),
        },
        select: { id: true },
      });
      await this.refreshSavedAmount(tx, goal);
      await tx.auditLog.create({
        data: {
          workspaceId,
          userId,
          entityType: "GOAL_CONTRIBUTION",
          entityId: contribution.id,
          action: amount.isNegative() ? "WITHDRAW" : "CONTRIBUTE",
          newData: {
            goalId,
            amount: fixed(amount),
            transactionId: input.transactionId ?? null,
          },
        },
      });
    });
    return this.get(workspaceId, goalId);
  }

  async reverseContribution(
    workspaceId: string,
    userId: string,
    goalId: string,
    contributionId: string,
  ) {
    await this.database.$transaction(async (tx) => {
      const goal = await this.requireGoal(workspaceId, goalId, tx);
      if (goal.deletedAt) throw new ConflictError("Meta archivada", "Restaure la meta antes de corregir aportes");
      const contribution = await tx.goalContribution.findFirst({
        where: { id: contributionId, goalId },
        select: { id: true, amount: true, transactionId: true, contributedAt: true },
      });
      if (!contribution) throw contributionNotFound();
      const previousReversal = await tx.auditLog.findFirst({
        where: { workspaceId, entityType: "GOAL_CONTRIBUTION", entityId: contributionId, action: "REVERSE" },
        select: { id: true },
      });
      if (previousReversal) throw new ConflictError("Aporte ya revertido", "Este aporte ya fue revertido");
      const compensatingAmount = contribution.amount.negated();
      if (compensatingAmount.lt(0) && compensatingAmount.abs().gt(goal.savedAmount))
        throw new ConflictError("No se puede revertir el aporte", "La reversión dejaría la meta con ahorro negativo");
      const compensating = await tx.goalContribution.create({
        data: {
          goalId,
          transactionId: null,
          amount: compensatingAmount,
          contributedAt: new Date(),
        },
        select: { id: true },
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
            transactionId: contribution.transactionId,
            contributedAt: contribution.contributedAt.toISOString(),
          },
          newData: { compensatingContributionId: compensating.id, amount: fixed(compensatingAmount) },
        },
      });
    });
    return this.get(workspaceId, goalId);
  }
}

export const goalsService = new GoalsService();
