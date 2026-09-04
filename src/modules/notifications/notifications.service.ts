import { Prisma, notification_type, type PrismaClient } from "@prisma/client";
import { NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { budgetsService } from "../budgets/budgets.service.js";
import { forecastsService } from "../forecasts/forecasts.service.js";
import { goalsService } from "../goals/goals.service.js";
import { liabilitiesService } from "../liabilities/liabilities.service.js";
import type { ListNotificationsInput } from "./notifications.schemas.js";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL" | "SUCCESS";

type SmartAlertData = {
  feature: "SMART_ALERT_CENTER";
  version: 1;
  dedupeKey: string;
  severity: AlertSeverity;
  source: "BUDGET" | "PAYMENT" | "LIQUIDITY" | "SPENDING" | "INCOME" | "GOAL";
  sourceId?: string;
  actionUrl?: string;
  actionLabel?: string;
  context?: Record<string, string | number | boolean | null>;
  dismissedAt?: string;
};

type Candidate = {
  type: notification_type;
  title: string;
  message: string;
  scheduledFor?: Date | null;
  data: SmartAlertData;
};

type PermissionContext = {
  roleCode: string;
  permissions: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const smartData = (value: Prisma.JsonValue): SmartAlertData | null => {
  if (!isObject(value) || value.feature !== "SMART_ALERT_CENTER" || value.version !== 1) return null;
  if (typeof value.dedupeKey !== "string" || typeof value.severity !== "string") return null;
  return value as unknown as SmartAlertData;
};

const jsonData = (value: SmartAlertData): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

const hasPermission = (context: PermissionContext, permission: string) =>
  context.roleCode === "OWNER" || context.permissions.includes(permission);

const localParts = (date: Date, timezone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day", string>;

const localDate = (date: Date, timezone: string) => {
  const parts = localParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const monthRange = (now: Date, timezone: string) => {
  const parts = localParts(now, timezone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const currentStart = new Date(Date.UTC(year, month - 1, 1));
  const currentEnd = new Date(Date.UTC(year, month - 1, day + 1));
  const previousMonthEndDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const previousStart = new Date(Date.UTC(year, month - 2, 1));
  const previousEnd = new Date(Date.UTC(year, month - 2, Math.min(day, previousMonthEndDay) + 1));
  return { currentStart, currentEnd, previousStart, previousEnd, periodKey: `${year}-${parts.month}` };
};

const paymentAction = (item: { type: string; resourceId: string }) => {
  if (item.type === "DEBT_INSTALLMENT") return `/app/debts/${item.resourceId}`;
  if (item.type === "OBLIGATION") return `/app/debts/obligations/${item.resourceId}`;
  return `/app/debts/cards/${item.resourceId}`;
};

export class NotificationsService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async budgetCandidates(
    workspaceId: string,
    timezone: string,
    permissions: PermissionContext,
  ): Promise<Candidate[]> {
    if (!hasPermission(permissions, "budgets.read")) return [];
    const result = await budgetsService.list(workspaceId, timezone, {
      includeArchived: "false",
      status: "ACTIVE",
      page: 1,
      limit: 100,
    });
    return result.items.flatMap((budget) => {
      if (budget.progress.status === "SAFE") return [];
      const exceeded = budget.progress.status === "EXCEEDED";
      const percentage = Number(budget.progress.percentage);
      const level = exceeded ? "exceeded" : "warning";
      return [
        {
          type: notification_type.BUDGET_ALERT,
          title: exceeded ? `Presupuesto excedido: ${budget.name}` : `Presupuesto cerca del límite: ${budget.name}`,
          message: exceeded
            ? `Has usado ${percentage.toFixed(0)}% de este presupuesto.`
            : `Has usado ${percentage.toFixed(0)}% y el aviso está configurado desde ${Number(budget.alertThreshold).toFixed(0)}%.`,
          data: {
            feature: "SMART_ALERT_CENTER",
            version: 1,
            dedupeKey: `budget:${budget.id}:${budget.endsOn}:${level}`,
            severity: exceeded ? "CRITICAL" : "WARNING",
            source: "BUDGET",
            sourceId: budget.id,
            actionUrl: "/app/budgets",
            actionLabel: "Ver presupuesto",
            context: {
              percentage,
              amount: Number(budget.amount),
              spent: Number(budget.progress.spent),
              currency: budget.currency,
            },
          },
        },
      ];
    });
  }

  private async paymentCandidates(
    workspaceId: string,
    permissions: PermissionContext,
    now: Date,
  ): Promise<Candidate[]> {
    if (!hasPermission(permissions, "debts.read")) return [];
    const items = await liabilitiesService.upcoming(workspaceId, now);
    return items.flatMap((item) => {
      if (item.daysRemaining > 7) return [];
      const overdue = item.daysRemaining < 0 || item.status === "OVERDUE";
      const urgent = overdue || item.daysRemaining <= 1;
      const timing = overdue
        ? `Venció hace ${Math.abs(item.daysRemaining)} día${Math.abs(item.daysRemaining) === 1 ? "" : "s"}.`
        : item.daysRemaining === 0
          ? "Vence hoy."
          : item.daysRemaining === 1
            ? "Vence mañana."
            : `Vence en ${item.daysRemaining} días.`;
      return [
        {
          type: notification_type.PAYMENT_DUE,
          title: overdue ? `Pago vencido: ${item.name}` : `Pago próximo: ${item.name}`,
          message: `${timing} Monto pendiente: ${item.amount} ${item.currency}.`,
          scheduledFor: new Date(`${item.date}T12:00:00Z`),
          data: {
            feature: "SMART_ALERT_CENTER",
            version: 1,
            dedupeKey: `payment:${item.type}:${item.id}:${item.date}`,
            severity: urgent ? "CRITICAL" : "WARNING",
            source: "PAYMENT",
            sourceId: item.id,
            actionUrl: paymentAction(item),
            actionLabel: "Revisar pago",
            context: {
              date: item.date,
              amount: Number(item.amount),
              currency: item.currency,
              daysRemaining: item.daysRemaining,
              resourceId: item.resourceId,
              resourceType: item.type,
            },
          },
        },
      ];
    });
  }

  private async liquidityCandidates(
    workspaceId: string,
    userId: string,
    baseCurrency: string,
    timezone: string,
    permissions: PermissionContext,
    now: Date,
  ): Promise<Candidate[]> {
    if (!hasPermission(permissions, "reports.read")) return [];
    const forecast = await forecastsService.monthEnd(workspaceId, baseCurrency, timezone, userId, now);
    const primary = forecast.primary;
    if (!primary || !["MEDIUM", "HIGH"].includes(primary.dataQuality)) return [];
    const lowest = Number(primary.lowestProjectedBalance.amount);
    if (!Number.isFinite(lowest) || lowest >= 0) return [];
    return [
      {
        type: notification_type.LIQUIDITY_RISK,
        title: "Riesgo de liquidez detectado",
        message: `La proyección indica un mínimo de ${primary.lowestProjectedBalance.amount} ${primary.currency} alrededor del ${primary.lowestProjectedBalance.date}.`,
        scheduledFor: new Date(`${primary.lowestProjectedBalance.date}T12:00:00Z`),
        data: {
          feature: "SMART_ALERT_CENTER",
          version: 1,
          dedupeKey: `liquidity:${primary.currency}:${forecast.period.dateTo}`,
          severity: "CRITICAL",
          source: "LIQUIDITY",
          actionUrl: "/app",
          actionLabel: "Ver proyección",
          context: {
            lowestProjectedBalance: lowest,
            date: primary.lowestProjectedBalance.date,
            dataQuality: primary.dataQuality,
            periodEnd: forecast.period.dateTo,
          },
        },
      },
    ];
  }

  private async behaviorCandidates(
    workspaceId: string,
    timezone: string,
    permissions: PermissionContext,
    now: Date,
  ): Promise<Candidate[]> {
    if (!hasPermission(permissions, "transactions.read")) return [];
    const range = monthRange(now, timezone);
    const aggregate = async (type: "EXPENSE" | "INCOME", start: Date, end: Date) => {
      const [sum, count] = await Promise.all([
        this.db.transaction.aggregate({
          where: {
            workspaceId,
            type,
            status: "CONFIRMED",
            occurredAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
        this.db.transaction.count({
          where: {
            workspaceId,
            type,
            status: "CONFIRMED",
            occurredAt: { gte: start, lt: end },
          },
        }),
      ]);
      return { total: Number(sum._sum.amount ?? 0), count };
    };
    const [currentExpense, previousExpense, currentIncome, previousIncome] = await Promise.all([
      aggregate("EXPENSE", range.currentStart, range.currentEnd),
      aggregate("EXPENSE", range.previousStart, range.previousEnd),
      aggregate("INCOME", range.currentStart, range.currentEnd),
      aggregate("INCOME", range.previousStart, range.previousEnd),
    ]);
    const candidates: Candidate[] = [];
    if (previousExpense.total > 0 && currentExpense.count >= 3 && previousExpense.count >= 3) {
      const change = ((currentExpense.total - previousExpense.total) / previousExpense.total) * 100;
      if (change >= 30) {
        candidates.push({
          type: notification_type.UNUSUAL_SPENDING,
          title: "Tus gastos aumentaron este mes",
          message: `En el mismo tramo del mes estás gastando aproximadamente ${change.toFixed(0)}% más que el mes anterior.`,
          data: {
            feature: "SMART_ALERT_CENTER",
            version: 1,
            dedupeKey: `spending-rise:${range.periodKey}`,
            severity: change >= 60 ? "CRITICAL" : "WARNING",
            source: "SPENDING",
            actionUrl: "/app/reports",
            actionLabel: "Ver gastos",
            context: {
              changePercent: Number(change.toFixed(2)),
              current: currentExpense.total,
              previous: previousExpense.total,
            },
          },
        });
      }
    }
    if (previousIncome.total > 0 && currentIncome.count >= 1 && previousIncome.count >= 1) {
      const drop = ((previousIncome.total - currentIncome.total) / previousIncome.total) * 100;
      if (drop >= 25) {
        candidates.push({
          type: notification_type.INCOME_DROP,
          title: "Tus ingresos están por debajo del mes anterior",
          message: `En el mismo tramo del mes has recibido aproximadamente ${drop.toFixed(0)}% menos ingresos.`,
          data: {
            feature: "SMART_ALERT_CENTER",
            version: 1,
            dedupeKey: `income-drop:${range.periodKey}`,
            severity: drop >= 50 ? "CRITICAL" : "WARNING",
            source: "INCOME",
            actionUrl: "/app/reports",
            actionLabel: "Ver ingresos",
            context: {
              changePercent: Number(drop.toFixed(2)),
              current: currentIncome.total,
              previous: previousIncome.total,
            },
          },
        });
      }
    }
    return candidates;
  }

  private async goalCandidates(
    workspaceId: string,
    permissions: PermissionContext,
  ): Promise<Candidate[]> {
    if (!hasPermission(permissions, "goals.read")) return [];
    const result = await goalsService.list(workspaceId, {
      includeArchived: "false",
      page: 1,
      limit: 100,
    });
    const milestones = [100, 90, 75, 50];
    return result.items.flatMap((goal) => {
      if (["CANCELLED", "PAUSED"].includes(goal.status)) return [];
      const target = Number(goal.targetAmount);
      const saved = Number(goal.savedAmount);
      if (!(target > 0) || saved <= 0) return [];
      const percentage = Math.min(100, (saved / target) * 100);
      const milestone = milestones.find((value) => percentage >= value);
      if (!milestone) return [];
      return [
        {
          type: notification_type.GOAL_PROGRESS,
          title: milestone === 100 ? `Meta alcanzada: ${goal.name}` : `${goal.name} llegó al ${milestone}%`,
          message:
            milestone === 100
              ? "Alcanzaste el valor objetivo de esta meta."
              : `Llevas ${saved.toFixed(2)} de ${target.toFixed(2)} en esta meta.`,
          data: {
            feature: "SMART_ALERT_CENTER",
            version: 1,
            dedupeKey: `goal:${goal.id}:milestone:${milestone}`,
            severity: milestone === 100 ? "SUCCESS" : "INFO",
            source: "GOAL",
            sourceId: goal.id,
            actionUrl: `/app/goals/${goal.id}`,
            actionLabel: "Ver meta",
            context: { percentage: Number(percentage.toFixed(2)), milestone, saved, target },
          },
        },
      ];
    });
  }

  async refresh(input: {
    workspaceId: string;
    userId: string;
    baseCurrency: string;
    timezone: string;
    permissionContext: PermissionContext;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const candidateGroups = await Promise.all([
      this.budgetCandidates(input.workspaceId, input.timezone, input.permissionContext),
      this.paymentCandidates(input.workspaceId, input.permissionContext, now),
      this.liquidityCandidates(
        input.workspaceId,
        input.userId,
        input.baseCurrency,
        input.timezone,
        input.permissionContext,
        now,
      ),
      this.behaviorCandidates(input.workspaceId, input.timezone, input.permissionContext, now),
      this.goalCandidates(input.workspaceId, input.permissionContext),
    ]);
    const candidates = candidateGroups.flat();
    const existing = await this.db.notification.findMany({
      where: { userId: input.userId, workspaceId: input.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const byKey = new Map<string, (typeof existing)[number]>();
    for (const notification of existing) {
      const data = smartData(notification.data);
      if (data && !byKey.has(data.dedupeKey)) byKey.set(data.dedupeKey, notification);
    }

    let created = 0;
    for (const candidate of candidates) {
      if (byKey.has(candidate.data.dedupeKey)) continue;
      await this.db.notification.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          type: candidate.type,
          title: candidate.title,
          message: candidate.message,
          scheduledFor: candidate.scheduledFor ?? null,
          sentAt: now,
          data: jsonData(candidate.data),
        },
      });
      created += 1;
    }
    return { evaluated: candidates.length, created };
  }

  async list(userId: string, workspaceId: string, filters: ListNotificationsInput) {
    const rows = await this.db.notification.findMany({
      where: {
        userId,
        workspaceId,
        ...(filters.status === "UNREAD" ? { readAt: null } : {}),
        ...(filters.status === "READ" ? { readAt: { not: null } } : {}),
        ...(filters.type ? { type: filters.type } : {}),
      },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: 500,
    });
    const mapped = rows
      .map((row) => ({ row, data: smartData(row.data) }))
      .filter(({ data }) => filters.includeDismissed === "true" || !data?.dismissedAt);
    const start = (filters.page - 1) * filters.limit;
    const items = mapped.slice(start, start + filters.limit).map(({ row, data }) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      severity: data?.severity ?? "INFO",
      source: data?.source ?? "SYSTEM",
      sourceId: data?.sourceId ?? null,
      actionUrl: data?.actionUrl ?? null,
      actionLabel: data?.actionLabel ?? null,
      context: data?.context ?? {},
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      readAt: row.readAt?.toISOString() ?? null,
      dismissedAt: data?.dismissedAt ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
    return {
      items,
      page: filters.page,
      limit: filters.limit,
      total: mapped.length,
      totalPages: Math.ceil(mapped.length / filters.limit),
      unread: mapped.filter(({ row }) => !row.readAt).length,
    };
  }

  async summary(userId: string, workspaceId: string) {
    const rows = await this.db.notification.findMany({
      where: { userId, workspaceId, readAt: null },
      select: { data: true },
      take: 500,
    });
    return {
      unread: rows.filter((row) => !smartData(row.data)?.dismissedAt).length,
    };
  }

  private async requireOwned(userId: string, workspaceId: string, id: string) {
    const notification = await this.db.notification.findFirst({ where: { id, userId, workspaceId } });
    if (!notification) throw new NotFoundError("Alerta no encontrada");
    return notification;
  }

  async markRead(userId: string, workspaceId: string, id: string) {
    await this.requireOwned(userId, workspaceId, id);
    return this.db.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });
  }

  async markAllRead(userId: string, workspaceId: string) {
    const result = await this.db.notification.updateMany({
      where: { userId, workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async dismiss(userId: string, workspaceId: string, id: string) {
    const notification = await this.requireOwned(userId, workspaceId, id);
    const current = smartData(notification.data);
    const data: SmartAlertData = current ?? {
      feature: "SMART_ALERT_CENTER",
      version: 1,
      dedupeKey: `legacy:${id}`,
      severity: "INFO",
      source: "PAYMENT",
    };
    const dismissedAt = new Date();
    await this.db.notification.update({
      where: { id },
      data: {
        readAt: notification.readAt ?? dismissedAt,
        data: jsonData({ ...data, dismissedAt: dismissedAt.toISOString() }),
      },
    });
    return { id, dismissedAt: dismissedAt.toISOString() };
  }
}

export const notificationsService = new NotificationsService();
