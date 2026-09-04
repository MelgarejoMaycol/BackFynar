export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "BIMONTHLY"
  | "QUARTERLY"
  | "YEARLY";

export type RecurringAmountType = "FIXED" | "VARIABLE";

export interface RecurringDetectionTransaction {
  id: string;
  type: string;
  status?: string | null;
  amount: number;
  occurredAt: Date | string;
  accountId?: string | null;
  categoryId?: string | null;
  merchantName?: string | null;
  description?: string | null;
}

export interface RecurringDetectionCandidate {
  fingerprint: string;
  normalizedLabel: string;
  displayLabel: string;
  frequency: RecurringFrequency;
  amountType: RecurringAmountType;
  typicalAmount: number;
  minAmount: number;
  maxAmount: number;
  confidence: number;
  evidenceCount: number;
  transactionIds: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  nextExpectedAt: Date;
  accountId: string | null;
  categoryId: string | null;
  reasons: string[];
}

export interface RecurringDetectorOptions {
  minimumEvidence: number;
  minimumConfidence: number;
  maximumVariableAmountCv: number;
}

const DEFAULT_OPTIONS: RecurringDetectorOptions = {
  minimumEvidence: 3,
  minimumConfidence: 0.65,
  maximumVariableAmountCv: 0.45,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const FREQUENCY_WINDOWS: Array<{
  frequency: RecurringFrequency;
  minDays: number;
  maxDays: number;
  expectedDays: number;
}> = [
  { frequency: "WEEKLY", minDays: 5, maxDays: 9, expectedDays: 7 },
  { frequency: "BIWEEKLY", minDays: 12, maxDays: 18, expectedDays: 14 },
  { frequency: "MONTHLY", minDays: 26, maxDays: 35, expectedDays: 30 },
  { frequency: "BIMONTHLY", minDays: 52, maxDays: 70, expectedDays: 61 },
  { frequency: "QUARTERLY", minDays: 80, maxDays: 100, expectedDays: 91 },
  { frequency: "YEARLY", minDays: 350, maxDays: 380, expectedDays: 365 },
];

const NON_PAYMENT_TYPES = new Set(["TRANSFER", "DEBT_PAYMENT", "ADJUSTMENT", "REFUND"]);

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid recurring detection date: ${String(value)}`);
  }
  return date;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (avg === 0) return Number.POSITIVE_INFINITY;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(avg);
}

function modeNullable(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let selected: string | null = null;
  let selectedCount = 0;
  for (const [value, count] of counts) {
    if (count > selectedCount) {
      selected = value;
      selectedCount = count;
    }
  }
  return selected;
}

export function normalizeRecurringLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(www|com|co|net)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pago|compra|debito|credito|card|tarjeta)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transactionLabel(transaction: RecurringDetectionTransaction): string {
  return transaction.merchantName?.trim() || transaction.description?.trim() || "";
}

function detectFrequency(dates: Date[]): {
  frequency: RecurringFrequency;
  intervalConsistency: number;
  expectedDays: number;
} | null {
  if (dates.length < 2) return null;

  const intervals: number[] = [];
  for (let index = 1; index < dates.length; index += 1) {
    const previous = dates[index - 1]!;
    const current = dates[index]!;
    intervals.push(Math.round((current.getTime() - previous.getTime()) / DAY_MS));
  }

  const medianInterval = median(intervals);
  const window = FREQUENCY_WINDOWS.find(
    (candidate) => medianInterval >= candidate.minDays && medianInterval <= candidate.maxDays,
  );
  if (!window) return null;

  const matchingIntervals = intervals.filter(
    (days) => days >= window.minDays && days <= window.maxDays,
  ).length;

  return {
    frequency: window.frequency,
    intervalConsistency: matchingIntervals / intervals.length,
    expectedDays: window.expectedDays,
  };
}

function addExpectedPeriod(date: Date, frequency: RecurringFrequency, expectedDays: number): Date {
  const next = new Date(date.getTime());
  if (frequency === "MONTHLY") {
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  if (frequency === "BIMONTHLY") {
    next.setUTCMonth(next.getUTCMonth() + 2);
    return next;
  }
  if (frequency === "QUARTERLY") {
    next.setUTCMonth(next.getUTCMonth() + 3);
    return next;
  }
  if (frequency === "YEARLY") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }
  next.setUTCDate(next.getUTCDate() + expectedDays);
  return next;
}

function buildFingerprint(normalizedLabel: string, accountId: string | null, frequency: RecurringFrequency): string {
  return `${normalizedLabel}:${accountId ?? "any-account"}:${frequency}`;
}

export function detectRecurringPayments(
  transactions: RecurringDetectionTransaction[],
  options: Partial<RecurringDetectorOptions> = {},
): RecurringDetectionCandidate[] {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const groups = new Map<string, RecurringDetectionTransaction[]>();

  for (const transaction of transactions) {
    if (transaction.status === "CANCELLED") continue;
    if (transaction.type !== "EXPENSE" || NON_PAYMENT_TYPES.has(transaction.type)) continue;
    if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) continue;

    const rawLabel = transactionLabel(transaction);
    const normalizedLabel = normalizeRecurringLabel(rawLabel);
    if (normalizedLabel.length < 2) continue;

    const groupKey = `${normalizedLabel}:${transaction.accountId ?? "any-account"}`;
    const group = groups.get(groupKey) ?? [];
    group.push(transaction);
    groups.set(groupKey, group);
  }

  const candidates: RecurringDetectionCandidate[] = [];

  for (const group of groups.values()) {
    if (group.length < config.minimumEvidence) continue;

    const sorted = [...group].sort(
      (a, b) => toDate(a.occurredAt).getTime() - toDate(b.occurredAt).getTime(),
    );
    const dates = sorted.map((transaction) => toDate(transaction.occurredAt));
    const frequency = detectFrequency(dates);
    if (!frequency || frequency.intervalConsistency < 0.66) continue;

    const amounts = sorted.map((transaction) => transaction.amount);
    const amountCv = coefficientOfVariation(amounts);
    if (!Number.isFinite(amountCv) || amountCv > config.maximumVariableAmountCv) continue;

    const amountType: RecurringAmountType = amountCv <= 0.05 ? "FIXED" : "VARIABLE";
    const amountConsistency = Math.max(0, 1 - amountCv / config.maximumVariableAmountCv);
    const evidenceScore = Math.min(1, group.length / 5);
    const confidence = roundConfidence(
      0.45 * frequency.intervalConsistency + 0.3 * amountConsistency + 0.25 * evidenceScore,
    );
    if (confidence < config.minimumConfidence) continue;

    const normalizedLabel = normalizeRecurringLabel(transactionLabel(sorted[0]!));
    const accountId = sorted[0]!.accountId ?? null;
    const categoryId = modeNullable(sorted.map((transaction) => transaction.categoryId ?? null));
    const lastSeenAt = dates[dates.length - 1]!;
    const typicalAmount = roundMoney(median(amounts));

    candidates.push({
      fingerprint: buildFingerprint(normalizedLabel, accountId, frequency.frequency),
      normalizedLabel,
      displayLabel: transactionLabel(sorted[sorted.length - 1]!),
      frequency: frequency.frequency,
      amountType,
      typicalAmount,
      minAmount: roundMoney(Math.min(...amounts)),
      maxAmount: roundMoney(Math.max(...amounts)),
      confidence,
      evidenceCount: sorted.length,
      transactionIds: sorted.map((transaction) => transaction.id),
      firstSeenAt: dates[0]!,
      lastSeenAt,
      nextExpectedAt: addExpectedPeriod(lastSeenAt, frequency.frequency, frequency.expectedDays),
      accountId,
      categoryId,
      reasons: [
        `${sorted.length} movimientos similares`,
        `intervalo ${frequency.frequency.toLowerCase()} consistente`,
        amountType === "FIXED" ? "monto estable" : "monto variable dentro del patrón",
      ],
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount);
}
