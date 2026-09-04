import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { obligationsService } from "../obligations/obligations.service.js";
import type { CreateObligationInput } from "../obligations/obligations.schemas.js";
import type { ConfirmRecurringSuggestionInput } from "./recurring-detection.schemas.js";
import {
  candidateToObligationInput,
  recurringDetectionService,
} from "./recurring-detection.service.js";
import type { RecurringDetectionCandidate } from "./domain/index.js";

const MODEL_VERSION = "recurring-detection-v1";
const DISMISS_COOLDOWN_DAYS = 90;
const FEATURE = "RECURRING_PAYMENT_DETECTION";

type InsightPayload = {
  feature: typeof FEATURE;
  state: "PENDING" | "DISMISSED" | "CONFIRMED";
  fingerprint: string;
  candidate: Record<string, unknown>;
  dismissedAt?: string;
  confirmedAt?: string;
  obligationId?: string;
};

const confirmationLocks = new Set<string>();

const serializeCandidate = (candidate: RecurringDetectionCandidate) => ({
  ...candidate,
  firstSeenAt: candidate.firstSeenAt.toISOString(),
  lastSeenAt: candidate.lastSeenAt.toISOString(),
  nextExpectedAt: candidate.nextExpectedAt.toISOString(),
});

const toJson = (payload: InsightPayload): Prisma.InputJsonValue =>
  payload as unknown as Prisma.InputJsonValue;

const payloadOf = (data: unknown): InsightPayload | null => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.feature !== FEATURE || typeof value.fingerprint !== "string") return null;
  if (value.state !== "PENDING" && value.state !== "DISMISSED" && value.state !== "CONFIRMED") {
    return null;
  }
  if (!value.candidate || typeof value.candidate !== "object" || Array.isArray(value.candidate)) {
    return null;
  }
  return value as InsightPayload;
};

const summaryFor = (candidate: RecurringDetectionCandidate) =>
  `${candidate.evidenceCount} movimientos similares · ${candidate.frequency.toLowerCase()} · monto ${candidate.amountType.toLowerCase()}`;

const boundedMonths = (months: number) => Math.max(3, Math.min(24, Math.trunc(months)));

export class RecurringDetectionWorkflow {
  constructor(private readonly db: PrismaClient = prisma) {}

  async run(workspaceId: string, months = 12) {
    const scan = await recurringDetectionService.suggestions(workspaceId, boundedMonths(months));
    const existing = await this.db.aiInsight.findMany({
      where: { workspaceId, type: "SPENDING_PATTERN", modelVersion: MODEL_VERSION },
      orderBy: { createdAt: "desc" },
    });
    const byFingerprint = new Map<string, (typeof existing)[number]>();
    for (const insight of existing) {
      const payload = payloadOf(insight.data);
      if (payload && !byFingerprint.has(payload.fingerprint)) byFingerprint.set(payload.fingerprint, insight);
    }

    const now = new Date();
    const suggestions: Array<{ id: string; candidate: RecurringDetectionCandidate }> = [];

    for (const candidate of scan.suggestions) {
      const previous = byFingerprint.get(candidate.fingerprint);
      const payload: InsightPayload = {
        feature: FEATURE,
        state: "PENDING",
        fingerprint: candidate.fingerprint,
        candidate: serializeCandidate(candidate),
      };

      if (previous) {
        const oldPayload = payloadOf(previous.data);
        if (oldPayload?.state === "CONFIRMED") continue;
        if (previous.isDismissed && previous.validUntil && previous.validUntil > now) continue;

        const refreshed = await this.db.aiInsight.update({
          where: { id: previous.id },
          data: {
            title: `Posible pago recurrente: ${candidate.displayLabel}`,
            summary: summaryFor(candidate),
            confidence: candidate.confidence.toFixed(4),
            data: toJson(payload),
            isDismissed: false,
            isRead: false,
            validFrom: candidate.firstSeenAt,
            validUntil: null,
          },
        });
        suggestions.push({ id: refreshed.id, candidate });
        continue;
      }

      const created = await this.db.aiInsight.create({
        data: {
          workspaceId,
          type: "SPENDING_PATTERN",
          title: `Posible pago recurrente: ${candidate.displayLabel}`,
          summary: summaryFor(candidate),
          severity: 1,
          confidence: candidate.confidence.toFixed(4),
          data: toJson(payload),
          validFrom: candidate.firstSeenAt,
          modelVersion: MODEL_VERSION,
        },
      });
      suggestions.push({ id: created.id, candidate });
    }

    return { ...scan, suggestions };
  }

  async dismiss(workspaceId: string, suggestionId: string) {
    const insight = await this.db.aiInsight.findFirst({
      where: { id: suggestionId, workspaceId, type: "SPENDING_PATTERN", modelVersion: MODEL_VERSION },
    });
    if (!insight) throw new NotFoundError("Sugerencia recurrente no encontrada");
    const payload = payloadOf(insight.data);
    if (!payload || payload.state === "CONFIRMED") {
      throw new ConflictError("La sugerencia ya no puede descartarse");
    }
    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setUTCDate(validUntil.getUTCDate() + DISMISS_COOLDOWN_DAYS);
    const updatedPayload: InsightPayload = {
      ...payload,
      state: "DISMISSED",
      dismissedAt: now.toISOString(),
    };
    const updated = await this.db.aiInsight.update({
      where: { id: insight.id },
      data: { isDismissed: true, isRead: true, validUntil, data: toJson(updatedPayload) },
    });
    return { id: updated.id, dismissedUntil: validUntil };
  }

  private async validateReferences(
    workspaceId: string,
    accountId: string | null | undefined,
    categoryId: string | null | undefined,
  ) {
    if (accountId) {
      const account = await this.db.financialAccount.findFirst({
        where: { id: accountId, workspaceId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!account) throw new NotFoundError("Cuenta pagadora no encontrada");
    }
    if (categoryId) {
      const category = await this.db.category.findFirst({
        where: {
          id: categoryId,
          isActive: true,
          deletedAt: null,
          type: "EXPENSE",
          OR: [{ workspaceId }, { workspaceId: null }],
        },
        select: { id: true },
      });
      if (!category) throw new NotFoundError("Categoría de gasto no encontrada");
    }
  }

  async confirm(workspaceId: string, suggestionId: string, input: ConfirmRecurringSuggestionInput) {
    const lockKey = `${workspaceId}:${suggestionId}`;
    if (confirmationLocks.has(lockKey)) {
      throw new ConflictError("La sugerencia ya se está confirmando");
    }
    confirmationLocks.add(lockKey);
    try {
      const insight = await this.db.aiInsight.findFirst({
        where: { id: suggestionId, workspaceId, type: "SPENDING_PATTERN", modelVersion: MODEL_VERSION },
      });
      if (!insight) throw new NotFoundError("Sugerencia recurrente no encontrada");
      const payload = payloadOf(insight.data);
      if (!payload || payload.state === "CONFIRMED") {
        throw new ConflictError("La sugerencia ya fue confirmada");
      }

      const [scan, workspace] = await Promise.all([
        recurringDetectionService.suggestions(workspaceId, boundedMonths(input.months ?? 12)),
        this.db.workspace.findUnique({ where: { id: workspaceId }, select: { baseCurrency: true } }),
      ]);
      if (!workspace) throw new NotFoundError("Workspace no encontrado");
      const candidate = scan.suggestions.find((item) => item.fingerprint === payload.fingerprint);
      if (!candidate) {
        throw new NotFoundError("El patrón ya no es válido o ya existe como pago recurrente");
      }

      const correctedCandidate: RecurringDetectionCandidate = {
        ...candidate,
        ...(input.frequency ? { frequency: input.frequency } : {}),
      };
      const base = candidateToObligationInput(correctedCandidate, workspace.baseCurrency);
      const obligationInput: CreateObligationInput = {
        ...base,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.expectedAmount !== undefined ? { expectedAmount: input.expectedAmount } : {}),
        ...(input.amountType !== undefined ? { amountType: input.amountType } : {}),
        ...(input.paymentAccountId !== undefined ? { paymentAccountId: input.paymentAccountId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.remindersEnabled !== undefined ? { remindersEnabled: input.remindersEnabled } : {}),
        ...(input.startsOn !== undefined ? { startsOn: input.startsOn } : {}),
      };
      await this.validateReferences(
        workspaceId,
        obligationInput.paymentAccountId,
        obligationInput.categoryId,
      );

      const obligation = await obligationsService.create(workspaceId, obligationInput);
      const now = new Date();
      const confirmedPayload: InsightPayload = {
        feature: FEATURE,
        state: "CONFIRMED",
        fingerprint: candidate.fingerprint,
        candidate: serializeCandidate(candidate),
        confirmedAt: now.toISOString(),
        obligationId: obligation.id,
      };
      await this.db.aiInsight.update({
        where: { id: insight.id },
        data: { isRead: true, isDismissed: false, validUntil: null, data: toJson(confirmedPayload) },
      });
      return {
        obligation,
        source: {
          suggestionId: insight.id,
          fingerprint: candidate.fingerprint,
          confidence: candidate.confidence,
          evidenceCount: candidate.evidenceCount,
          transactionIds: candidate.transactionIds,
        },
      };
    } finally {
      confirmationLocks.delete(lockKey);
    }
  }
}

export const recurringDetectionWorkflow = new RecurringDetectionWorkflow();
