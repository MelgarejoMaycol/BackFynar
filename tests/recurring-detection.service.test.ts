import { describe, expect, it } from "vitest";
import type { RecurringDetectionCandidate } from "../src/modules/recurring-detection/domain/index.js";
import { isCandidateAlreadyConfigured } from "../src/modules/recurring-detection/recurring-detection.service.js";

const candidate = (overrides: Partial<RecurringDetectionCandidate> = {}): RecurringDetectionCandidate => ({
  fingerprint: "netflix:account-1:MONTHLY",
  normalizedLabel: "netflix",
  displayLabel: "Netflix",
  frequency: "MONTHLY",
  amountType: "FIXED",
  typicalAmount: 26900,
  minAmount: 26900,
  maxAmount: 26900,
  confidence: 0.92,
  evidenceCount: 4,
  transactionIds: ["1", "2", "3", "4"],
  firstSeenAt: new Date("2026-05-05T00:00:00Z"),
  lastSeenAt: new Date("2026-08-05T00:00:00Z"),
  nextExpectedAt: new Date("2026-09-05T00:00:00Z"),
  accountId: "account-1",
  categoryId: null,
  reasons: [],
  ...overrides,
});

describe("isCandidateAlreadyConfigured", () => {
  it("deduplica una obligación mensual existente con el mismo nombre normalizado y cuenta", () => {
    expect(
      isCandidateAlreadyConfigured(candidate(), [
        {
          name: "NETFLIX.COM",
          paymentAccountId: "account-1",
          recurrenceRules: { frequency: "MONTHLY", intervalValue: 1 },
        },
      ]),
    ).toBe(true);
  });

  it("respeta la cuenta pagadora cuando la obligación tiene una configurada", () => {
    expect(
      isCandidateAlreadyConfigured(candidate(), [
        {
          name: "Netflix",
          paymentAccountId: "account-2",
          recurrenceRules: { frequency: "MONTHLY", intervalValue: 1 },
        },
      ]),
    ).toBe(false);
  });

  it("mapea quincenal a WEEKLY con intervalo 2", () => {
    expect(
      isCandidateAlreadyConfigured(candidate({ frequency: "BIWEEKLY" }), [
        {
          name: "Netflix",
          paymentAccountId: "account-1",
          recurrenceRules: { frequency: "WEEKLY", intervalValue: 2 },
        },
      ]),
    ).toBe(true);
  });

  it("mapea trimestral a MONTHLY con intervalo 3", () => {
    expect(
      isCandidateAlreadyConfigured(candidate({ frequency: "QUARTERLY" }), [
        {
          name: "Netflix",
          paymentAccountId: null,
          recurrenceRules: { frequency: "MONTHLY", intervalValue: 3 },
        },
      ]),
    ).toBe(true);
  });
});
