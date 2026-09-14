import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors/app-error.js";
import { reservationsByAccount } from "../goals/goals.reservations.js";
import { simulateInvestment } from "../simulations/investment-simulation.engine.js";
import type {
  CreateInvestmentPlanInput,
  InvestmentContributionInput,
  InvestmentPlanListInput,
  InvestmentValuationInput,
  InvestmentWithdrawalInput,
  StartInvestmentPlanInput,
  UpdateInvestmentPlanInput,
} from "./investments.schemas.js";

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = D(0);
const ONE = D(1);
const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;

const fixed = (value: Prisma.Decimal) => value.toDecimalPlaces(2).toFixed(2);
const fixedRate = (value: Prisma.Decimal) => value.toDecimalPlaces(8).toFixed(8);
const dateOnly = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type Frequency = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

const planNotFound = () => new NotFoundError("Plan de inversión no encontrado");

const addDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const addMonthsClamped = (date: Date, months: number) => {
  const targetFirst = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetFirst.getUTCFullYear(),
      targetFirst.getUTCMonth(),
      Math.min(date.getUTCDate(), lastDay),
    ),
  );
};

const nextFrequencyDate = (date: Date, frequency: Frequency) => {
  if (frequency === "DAILY") return addDays(date, 1);
  if (frequency === "WEEKLY") return addDays(date, 7);
  if (frequency === "MONTHLY") return addMonthsClamped(date, 1);
  if (frequency === "QUARTERLY") return addMonthsClamped(date, 3);
  if (frequency === "YEARLY") return addMonthsClamped(date, 12);
  return null;
};

function scheduleInfo(startDate: Date, frequency: Frequency, asOf: Date) {
  if (frequency === "NONE") {
    return { elapsedEvents: 0, nextSuggestedDate: null as Date | null };
  }
  let cursor = nextFrequencyDate(startDate, frequency);
  let elapsedEvents = 0;
  let safety = 0;
  while (cursor && cursor.getTime() <= asOf.getTime() && safety < 25_000) {
    elapsedEvents += 1;
    cursor = nextFrequencyDate(cursor, frequency);
    safety += 1;
  }
  return { elapsedEvents, nextSuggestedDate: cursor };
}

function projectedValueAtDate(
  startDate: Date,
  asOf: Date,
  initialAmount: Prisma.Decimal,
  recurringContribution: Prisma.Decimal,
  frequency: Frequency,
  annualReturn: Prisma.Decimal,
  annualFee: Prisma.Decimal,
) {
  if (asOf.getTime() <= startDate.getTime()) return initialAmount;
  const grossDaily = ONE.plus(annualReturn).pow(ONE.div(DAYS_PER_YEAR));
  const feeDaily = ONE.minus(annualFee).pow(ONE.div(DAYS_PER_YEAR));
  const dailyFactor = grossDaily.mul(feeDaily);
  const totalDays = Math.max(0, Math.floor((asOf.getTime() - startDate.getTime()) / DAY_MS));
  let balance = initialAmount;
  let nextContributionDate = nextFrequencyDate(startDate, frequency);

  for (let offset = 1; offset <= totalDays; offset += 1) {
    balance = balance.mul(dailyFactor);
    const currentDate = addDays(startDate, offset);
    while (
      nextContributionDate &&
      nextContributionDate.getTime() <= currentDate.getTime()
    ) {
      if (recurringContribution.gt(0)) balance = balance.plus(recurringContribution);
      nextContributionDate = nextFrequencyDate(nextContributionDate, frequency);
    }
  }
  return balance;
}

type PlanRow = Prisma.InvestmentPlanGetPayload<{
  include: {
    contributions: { orderBy: { occurredAt: "desc" }; take: 12; include: { sourceAccount: true } };
    withdrawals: {
      orderBy: { occurredAt: "desc" };
      take: 12;
      include: { destinationAccount: true };
    };
    valuations: { orderBy: { capturedAt: "desc" }; take: 12 };
  };
}>;

export class InvestmentsService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async plan(workspaceId: string, planId: string) {
    const plan = await this.db.investmentPlan.findFirst({
      where: { id: planId, workspaceId },
      include: {
        contributions: {
          orderBy: { occurredAt: "desc" },
          take: 12,
          include: { sourceAccount: true },
        },
        withdrawals: {
          orderBy: { occurredAt: "desc" },
          take: 12,
          include: { destinationAccount: true },
        },
        valuations: { orderBy: { capturedAt: "desc" }, take: 12 },
      },
    });
    if (!plan) throw planNotFound();
    return plan;
  }

  private async currentValue(
    client: Prisma.TransactionClient | PrismaClient,
    workspaceId: string,
    planId: string,
  ) {
    const latestValuation = await client.investmentValuation.findFirst({
      where: { workspaceId, planId },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    });
    const since = latestValuation?.capturedAt;
    const [contributions, withdrawals] = await Promise.all([
      client.investmentContribution.aggregate({
        where: {
          workspaceId,
          planId,
          ...(since ? { occurredAt: { gt: since } } : {}),
        },
        _sum: { amount: true },
      }),
      client.investmentWithdrawal.aggregate({
        where: {
          workspaceId,
          planId,
          ...(since ? { occurredAt: { gt: since } } : {}),
        },
        _sum: { amount: true },
      }),
    ]);
    const base = latestValuation?.value ?? ZERO;
    return {
      value: base
        .plus(contributions._sum.amount ?? ZERO)
        .minus(withdrawals._sum.amount ?? ZERO),
      basis: latestValuation ? ("MANUAL_PLUS_FLOWS" as const) : ("CASH_FLOWS_ONLY" as const),
      latestValuation,
    };
  }

  private async totals(workspaceId: string, planId: string) {
    const [contributions, withdrawals] = await Promise.all([
      this.db.investmentContribution.aggregate({
        where: { workspaceId, planId },
        _sum: { amount: true },
      }),
      this.db.investmentWithdrawal.aggregate({
        where: { workspaceId, planId },
        _sum: { amount: true },
      }),
    ]);
    const contributed = contributions._sum.amount ?? ZERO;
    const withdrawn = withdrawals._sum.amount ?? ZERO;
    return { contributed, withdrawn, netContributed: contributed.minus(withdrawn) };
  }

  private async progressFor(plan: PlanRow, now = new Date()) {
    const totals = await this.totals(plan.workspaceId, plan.id);
    const current = await this.currentValue(this.db, plan.workspaceId, plan.id);
    const startDate = plan.startDate;
    const frequency = plan.contributionFrequency as Frequency;

    const horizon = simulateInvestment({
      currency: plan.currency,
      initialAmount: plan.plannedInitialAmount.toString(),
      recurringContribution: plan.recurringContribution.toString(),
      contributionFrequency: frequency,
      years: plan.horizonYears,
      annualReturn: plan.annualReturn.toString(),
      annualFee: plan.annualFee.toString(),
      inflationRate: plan.inflationRate.toString(),
    });

    if (!startDate) {
      return {
        status: plan.status,
        actual: {
          totalContributed: fixed(totals.contributed),
          totalWithdrawn: fixed(totals.withdrawn),
          netContributed: fixed(totals.netContributed),
          currentValue: fixed(current.value),
          valuationBasis: current.basis,
          latestValuationAt: current.latestValuation?.capturedAt.toISOString() ?? null,
        },
        plan: {
          expectedContributedToDate: "0.00",
          projectedValueToday: "0.00",
          projectedValueAtHorizon: horizon.estimatedFinalValue,
          projectedProfitAtHorizon: horizon.estimatedProfit,
        },
        pace: {
          status: "NOT_STARTED",
          ratio: null,
          headline: "Tu plan está guardado y listo cuando quieras empezar",
          explanation:
            "No hay fechas vencidas ni pagos pendientes. Puedes iniciar y aportar cuando te resulte conveniente.",
        },
        nextSuggestion: null,
      };
    }

    const asOf = now.getTime() < startDate.getTime() ? startDate : now;
    const schedule = scheduleInfo(startDate, frequency, asOf);
    const expectedContributed = plan.plannedInitialAmount.plus(
      plan.recurringContribution.mul(schedule.elapsedEvents),
    );
    const projectedToday = projectedValueAtDate(
      startDate,
      asOf,
      plan.plannedInitialAmount,
      plan.recurringContribution,
      frequency,
      plan.annualReturn,
      plan.annualFee,
    );
    const ratio = expectedContributed.gt(0)
      ? totals.netContributed.div(expectedContributed)
      : ONE;

    const paceStatus =
      totals.netContributed.isZero() && expectedContributed.gt(0)
        ? "BELOW_PREFERRED_PACE"
        : ratio.gte(1.1)
          ? "AHEAD"
          : ratio.gte(0.9)
            ? "ON_TRACK"
            : "BELOW_PREFERRED_PACE";

    const paceCopy =
      paceStatus === "AHEAD"
        ? {
            headline: "Vas por encima del ritmo que elegiste",
            explanation:
              "Has aportado más de lo que el plan sugería hasta hoy. No necesitas compensar ni mantener ese ritmo.",
          }
        : paceStatus === "ON_TRACK"
          ? {
              headline: "Vas cerca del ritmo que elegiste",
              explanation:
                "Tus aportes están próximos a la referencia del plan. Sigue ajustándolo a tu realidad cuando lo necesites.",
            }
          : {
              headline: "Vas por debajo del ritmo que habías imaginado",
              explanation:
                "No es una deuda ni un atraso. El plan solo sirve como referencia y puedes retomar, reducir o pausar aportes cuando quieras.",
            };

    return {
      status: plan.status,
      actual: {
        totalContributed: fixed(totals.contributed),
        totalWithdrawn: fixed(totals.withdrawn),
        netContributed: fixed(totals.netContributed),
        currentValue: fixed(current.value),
        valuationBasis: current.basis,
        latestValuationAt: current.latestValuation?.capturedAt.toISOString() ?? null,
      },
      plan: {
        expectedContributedToDate: fixed(expectedContributed),
        projectedValueToday: fixed(projectedToday),
        projectedValueAtHorizon: horizon.estimatedFinalValue,
        projectedProfitAtHorizon: horizon.estimatedProfit,
        varianceCurrentVsProjected: fixed(current.value.minus(projectedToday)),
      },
      pace: {
        status: paceStatus,
        ratio: ratio.mul(100).toDecimalPlaces(2).toFixed(2),
        ...paceCopy,
      },
      nextSuggestion:
        plan.status === "ACTIVE" &&
        frequency !== "NONE" &&
        plan.recurringContribution.gt(0) &&
        schedule.nextSuggestedDate
          ? {
              date: dateOnly(schedule.nextSuggestedDate),
              amount: fixed(plan.recurringContribution),
              message:
                "Este es el próximo aporte sugerido por tu ritmo, no una obligación. Si no aportas ese día, no se genera deuda ni atraso.",
            }
          : null,
    };
  }

  private publicPlan(plan: PlanRow, progress: Awaited<ReturnType<InvestmentsService["progressFor"]>>) {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      currency: plan.currency.trim(),
      status: plan.status,
      plannedInitialAmount: fixed(plan.plannedInitialAmount),
      recurringContribution: fixed(plan.recurringContribution),
      contributionFrequency: plan.contributionFrequency,
      horizonYears: plan.horizonYears,
      annualReturn: fixedRate(plan.annualReturn),
      annualFee: fixedRate(plan.annualFee),
      inflationRate: fixedRate(plan.inflationRate),
      startDate: dateOnly(plan.startDate),
      includeInNetWorth: plan.includeInNetWorth,
      notes: plan.notes,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      progress,
      recentContributions: plan.contributions.map((entry) => ({
        id: entry.id,
        amount: fixed(entry.amount),
        occurredAt: entry.occurredAt.toISOString(),
        note: entry.note,
        sourceAccount: {
          id: entry.sourceAccount.id,
          name: entry.sourceAccount.name,
          currency: entry.sourceAccount.currency.trim(),
        },
      })),
      recentWithdrawals: plan.withdrawals.map((entry) => ({
        id: entry.id,
        amount: fixed(entry.amount),
        occurredAt: entry.occurredAt.toISOString(),
        note: entry.note,
        destinationAccount: {
          id: entry.destinationAccount.id,
          name: entry.destinationAccount.name,
          currency: entry.destinationAccount.currency.trim(),
        },
      })),
      recentValuations: plan.valuations.map((entry) => ({
        id: entry.id,
        value: fixed(entry.value),
        capturedAt: entry.capturedAt.toISOString(),
        note: entry.note,
      })),
    };
  }

  async list(workspaceId: string, input: InvestmentPlanListInput = {}) {
    const status = input.status ?? "ALL";
    const rows = await this.db.investmentPlan.findMany({
      where: {
        workspaceId,
        ...(status === "ALL" ? {} : { status }),
        ...(status === "ARCHIVED" ? {} : { archivedAt: null }),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        contributions: {
          orderBy: { occurredAt: "desc" },
          take: 12,
          include: { sourceAccount: true },
        },
        withdrawals: {
          orderBy: { occurredAt: "desc" },
          take: 12,
          include: { destinationAccount: true },
        },
        valuations: { orderBy: { capturedAt: "desc" }, take: 12 },
      },
    });
    return Promise.all(
      rows.map(async (plan) => this.publicPlan(plan, await this.progressFor(plan))),
    );
  }

  async get(workspaceId: string, planId: string) {
    const plan = await this.plan(workspaceId, planId);
    return this.publicPlan(plan, await this.progressFor(plan));
  }

  async create(workspaceId: string, userId: string, input: CreateInvestmentPlanInput) {
    const created = await this.db.investmentPlan.create({
      data: {
        workspaceId,
        createdBy: userId,
        name: input.name,
        description: input.description ?? null,
        currency: input.currency,
        plannedInitialAmount: D(input.plannedInitialAmount),
        recurringContribution: D(input.recurringContribution ?? "0"),
        contributionFrequency: input.contributionFrequency ?? "MONTHLY",
        horizonYears: input.horizonYears,
        annualReturn: D(input.annualReturn),
        annualFee: D(input.annualFee ?? "0"),
        inflationRate: D(input.inflationRate ?? "0"),
        includeInNetWorth: input.includeInNetWorth ?? true,
        notes: input.notes ?? null,
      },
    });
    await this.db.auditLog.create({
      data: {
        workspaceId,
        userId,
        entityType: "INVESTMENT_PLAN",
        entityId: created.id,
        action: "CREATE",
        newData: json({ name: created.name, status: created.status }),
      },
    });
    return this.get(workspaceId, created.id);
  }

  async update(
    workspaceId: string,
    userId: string,
    planId: string,
    input: UpdateInvestmentPlanInput,
  ) {
    const current = await this.db.investmentPlan.findFirst({ where: { id: planId, workspaceId } });
    if (!current) throw planNotFound();
    if (current.status === "ARCHIVED" || current.status === "COMPLETED")
      throw new ConflictError(
        "Plan cerrado",
        "Este plan ya está cerrado. Crea uno nuevo si quieres probar otro ritmo.",
      );

    if (
      input.currency &&
      input.currency !== current.currency &&
      (await this.db.investmentContribution.count({ where: { workspaceId, planId } })) > 0
    )
      throw new ConflictError(
        "Moneda bloqueada",
        "No puedes cambiar la moneda de un plan que ya tiene aportes registrados.",
      );

    await this.db.investmentPlan.update({
      where: { id: planId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.plannedInitialAmount !== undefined
          ? { plannedInitialAmount: D(input.plannedInitialAmount) }
          : {}),
        ...(input.recurringContribution !== undefined
          ? { recurringContribution: D(input.recurringContribution) }
          : {}),
        ...(input.contributionFrequency !== undefined
          ? { contributionFrequency: input.contributionFrequency }
          : {}),
        ...(input.horizonYears !== undefined ? { horizonYears: input.horizonYears } : {}),
        ...(input.annualReturn !== undefined ? { annualReturn: D(input.annualReturn) } : {}),
        ...(input.annualFee !== undefined ? { annualFee: D(input.annualFee) } : {}),
        ...(input.inflationRate !== undefined ? { inflationRate: D(input.inflationRate) } : {}),
        ...(input.includeInNetWorth !== undefined
          ? { includeInNetWorth: input.includeInNetWorth }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      },
    });
    await this.db.auditLog.create({
      data: {
        workspaceId,
        userId,
        entityType: "INVESTMENT_PLAN",
        entityId: planId,
        action: "UPDATE",
        newData: json(input),
      },
    });
    return this.get(workspaceId, planId);
  }

  async start(
    workspaceId: string,
    userId: string,
    planId: string,
    input: StartInvestmentPlanInput,
  ) {
    const plan = await this.db.investmentPlan.findFirst({ where: { id: planId, workspaceId } });
    if (!plan) throw planNotFound();
    if (plan.status !== "DRAFT")
      throw new ConflictError("Plan ya iniciado", "Este plan ya fue iniciado o cerrado.");
    const startDate = input.startDate
      ? new Date(`${input.startDate}T00:00:00.000Z`)
      : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    await this.db.investmentPlan.update({
      where: { id: planId },
      data: { status: "ACTIVE", startDate, pausedAt: null },
    });
    await this.db.auditLog.create({
      data: {
        workspaceId,
        userId,
        entityType: "INVESTMENT_PLAN",
        entityId: planId,
        action: "START",
        newData: json({ startDate: dateOnly(startDate) }),
      },
    });
    return this.get(workspaceId, planId);
  }

  async pause(workspaceId: string, userId: string, planId: string) {
    const changed = await this.db.investmentPlan.updateMany({
      where: { id: planId, workspaceId, status: "ACTIVE", archivedAt: null },
      data: { status: "PAUSED", pausedAt: new Date() },
    });
    if (!changed.count) throw new ConflictError("Solo un plan activo puede pausarse");
    await this.db.auditLog.create({
      data: { workspaceId, userId, entityType: "INVESTMENT_PLAN", entityId: planId, action: "PAUSE" },
    });
    return this.get(workspaceId, planId);
  }

  async resume(workspaceId: string, userId: string, planId: string) {
    const changed = await this.db.investmentPlan.updateMany({
      where: { id: planId, workspaceId, status: "PAUSED", archivedAt: null },
      data: { status: "ACTIVE", pausedAt: null },
    });
    if (!changed.count) throw new ConflictError("Solo un plan pausado puede reanudarse");
    await this.db.auditLog.create({
      data: { workspaceId, userId, entityType: "INVESTMENT_PLAN", entityId: planId, action: "RESUME" },
    });
    return this.get(workspaceId, planId);
  }

  async complete(workspaceId: string, userId: string, planId: string) {
    const changed = await this.db.investmentPlan.updateMany({
      where: { id: planId, workspaceId, status: { in: ["ACTIVE", "PAUSED"] }, archivedAt: null },
      data: { status: "COMPLETED", completedAt: new Date(), pausedAt: null },
    });
    if (!changed.count) throw new ConflictError("El plan no está activo");
    await this.db.auditLog.create({
      data: {
        workspaceId,
        userId,
        entityType: "INVESTMENT_PLAN",
        entityId: planId,
        action: "COMPLETE",
      },
    });
    return this.get(workspaceId, planId);
  }

  async archive(workspaceId: string, userId: string, planId: string) {
    const plan = await this.db.investmentPlan.findFirst({ where: { id: planId, workspaceId } });
    if (!plan) throw planNotFound();
    if (plan.status === "ACTIVE")
      throw new ConflictError(
        "Pausa o finaliza el plan primero",
        "Un plan activo no se archiva para evitar ocultar una inversión que todavía estás siguiendo.",
      );
    await this.db.investmentPlan.update({
      where: { id: planId },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await this.db.auditLog.create({
      data: {
        workspaceId,
        userId,
        entityType: "INVESTMENT_PLAN",
        entityId: planId,
        action: "ARCHIVE",
      },
    });
    return { id: planId, archived: true };
  }

  async contribute(
    workspaceId: string,
    userId: string,
    planId: string,
    input: InvestmentContributionInput,
  ) {
    const amount = D(input.amount);
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM investment_plans WHERE workspace_id=${workspaceId}::uuid AND id=${planId}::uuid FOR UPDATE`,
        );
        const plan = await tx.investmentPlan.findFirst({ where: { id: planId, workspaceId } });
        if (!plan) throw planNotFound();
        if (!["ACTIVE", "PAUSED"].includes(plan.status))
          throw new ConflictError(
            "Plan no disponible para aportes",
            "Inicia el plan antes de registrar aportes.",
          );

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM financial_accounts WHERE workspace_id=${workspaceId}::uuid AND id=${input.sourceAccountId}::uuid FOR UPDATE`,
        );
        const account = await tx.financialAccount.findFirst({
          where: {
            id: input.sourceAccountId,
            workspaceId,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
          },
        });
        if (!account || account.type === "LOAN" || account.type === "INVESTMENT")
          throw new NotFoundError("Cuenta de origen no disponible para aportar");
        if (account.currency.trim() !== plan.currency.trim())
          throw new ValidationError(
            "La cuenta y el plan deben usar la misma moneda. Convierte el dinero antes de registrar el aporte.",
          );
        const reservations = await reservationsByAccount(tx, workspaceId);
        const reserved =
          reservations.find((item) => item.accountId === account.id)?.reservedForGoals ?? ZERO;
        const available = account.currentBalance.minus(reserved);
        if (available.lt(amount))
          throw new ConflictError(
            "Saldo disponible insuficiente",
            "La cuenta no tiene suficiente dinero libre después de respetar lo reservado en metas.",
          );

        const occurredAt = new Date(input.occurredAt ?? new Date().toISOString());
        await tx.financialAccount.update({
          where: { id: account.id },
          data: { currentBalance: { decrement: amount } },
        });
        const transaction = await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type: "INVESTMENT",
            status: "CONFIRMED",
            amount,
            currency: plan.currency,
            accountId: account.id,
            occurredAt,
            description: `Aporte a inversión · ${plan.name}`,
            notes: input.note ?? null,
            metadata: { investment: true, planId, role: "CONTRIBUTION" },
          },
        });
        const contribution = await tx.investmentContribution.create({
          data: {
            workspaceId,
            planId,
            sourceAccountId: account.id,
            transactionId: transaction.id,
            amount,
            occurredAt,
            note: input.note ?? null,
            createdBy: userId,
          },
        });
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "INVESTMENT_CONTRIBUTION",
            entityId: contribution.id,
            action: "CREATE",
            newData: json({ planId, amount: fixed(amount), sourceAccountId: account.id }),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.get(workspaceId, planId);
  }

  async withdraw(
    workspaceId: string,
    userId: string,
    planId: string,
    input: InvestmentWithdrawalInput,
  ) {
    const amount = D(input.amount);
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM investment_plans WHERE workspace_id=${workspaceId}::uuid AND id=${planId}::uuid FOR UPDATE`,
        );
        const plan = await tx.investmentPlan.findFirst({ where: { id: planId, workspaceId } });
        if (!plan) throw planNotFound();
        if (plan.status === "DRAFT" || plan.status === "ARCHIVED")
          throw new ConflictError("Este plan todavía no tiene una inversión disponible para retirar");

        const current = await this.currentValue(tx, workspaceId, planId);
        if (current.value.lt(amount))
          throw new ConflictError(
            "Retiro superior al valor registrado",
            "El retiro no puede superar el valor actual que Fynar tiene registrado para esta inversión.",
          );

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM financial_accounts WHERE workspace_id=${workspaceId}::uuid AND id=${input.destinationAccountId}::uuid FOR UPDATE`,
        );
        const account = await tx.financialAccount.findFirst({
          where: {
            id: input.destinationAccountId,
            workspaceId,
            nature: "ASSET",
            isActive: true,
            deletedAt: null,
          },
        });
        if (!account || account.type === "LOAN" || account.type === "INVESTMENT")
          throw new NotFoundError("Cuenta de destino no disponible para el retiro");
        if (account.currency.trim() !== plan.currency.trim())
          throw new ValidationError(
            "La cuenta de destino y el plan deben usar la misma moneda.",
          );

        const occurredAt = new Date(input.occurredAt ?? new Date().toISOString());
        await tx.financialAccount.update({
          where: { id: account.id },
          data: { currentBalance: { increment: amount } },
        });
        const transaction = await tx.transaction.create({
          data: {
            workspaceId,
            createdBy: userId,
            type: "INVESTMENT",
            status: "CONFIRMED",
            amount,
            currency: plan.currency,
            accountId: account.id,
            occurredAt,
            description: `Retiro de inversión · ${plan.name}`,
            notes: input.note ?? null,
            metadata: { investment: true, planId, role: "WITHDRAWAL" },
          },
        });
        const withdrawal = await tx.investmentWithdrawal.create({
          data: {
            workspaceId,
            planId,
            destinationAccountId: account.id,
            transactionId: transaction.id,
            amount,
            occurredAt,
            note: input.note ?? null,
            createdBy: userId,
          },
        });
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId,
            entityType: "INVESTMENT_WITHDRAWAL",
            entityId: withdrawal.id,
            action: "CREATE",
            newData: json({ planId, amount: fixed(amount), destinationAccountId: account.id }),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.get(workspaceId, planId);
  }

  async addValuation(
    workspaceId: string,
    userId: string,
    planId: string,
    input: InvestmentValuationInput,
  ) {
    const plan = await this.db.investmentPlan.findFirst({ where: { id: planId, workspaceId } });
    if (!plan) throw planNotFound();
    if (plan.status === "DRAFT" || plan.status === "ARCHIVED")
      throw new ConflictError("Inicia el plan antes de registrar su valor actual");
    const valuation = await this.db.investmentValuation.create({
      data: {
        workspaceId,
        planId,
        value: D(input.value),
        capturedAt: new Date(input.capturedAt ?? new Date().toISOString()),
        note: input.note ?? null,
        createdBy: userId,
      },
    });
    await this.db.auditLog.create({
      data: {
        workspaceId,
        userId,
        entityType: "INVESTMENT_VALUATION",
        entityId: valuation.id,
        action: "CREATE",
        newData: json({ planId, value: input.value }),
      },
    });
    return this.get(workspaceId, planId);
  }

  async progress(workspaceId: string, planId: string) {
    const plan = await this.plan(workspaceId, planId);
    return this.progressFor(plan);
  }

  async netWorthByCurrency(workspaceId: string) {
    const plans = await this.db.investmentPlan.findMany({
      where: {
        workspaceId,
        includeInNetWorth: true,
        archivedAt: null,
        status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] },
      },
      select: { id: true, currency: true },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const plan of plans) {
      const current = await this.currentValue(this.db, workspaceId, plan.id);
      const currency = plan.currency.trim();
      totals.set(currency, (totals.get(currency) ?? ZERO).plus(current.value));
    }
    return [...totals.entries()].map(([currency, value]) => ({
      currency,
      value,
    }));
  }
}

export const investmentsService = new InvestmentsService();
