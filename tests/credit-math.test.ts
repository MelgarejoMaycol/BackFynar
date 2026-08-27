import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  CreditMathError,
  addContractPeriods,
  addContractMonths,
  calculateEstimatedEndDate,
  calculateFixedPayment,
  calculateInstallment,
  calculateNumberOfPeriods,
  calculatePaidInterest,
  calculatePaidPrincipal,
  calculateRemainingBalance,
  calculateRemainingInstallments,
  calculateRemainingInterest,
  calculateTotalCost,
  convertInterestRate,
  generateAmortizationSchedule,
  toEffectivePeriodic,
} from "../src/modules/debts/domain/index.js";

const d = (value: string | number) => new Prisma.Decimal(value);
const iso = (value: string) => new Date(`${value}T00:00:00.000Z`);
const expectCode = (operation: () => unknown, expected: string): void => {
  try {
    operation();
    throw new Error(`Expected ${expected}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CreditMathError);
    expect((error as CreditMathError).code).toBe(expected);
  }
};

describe("motor matemático de créditos", () => {
  it("calcula cuota fija y cronograma normal", () => {
    const payment = calculateFixedPayment({
      principal: "10000000",
      periodicRate: "0.01",
      numberOfInstallments: 36,
    });
    expect(payment.toFixed(2)).toBe("332143.10");
    const schedule = generateAmortizationSchedule({
      principal: "10000000",
      periodicRate: "0.01",
      numberOfInstallments: 36,
      firstPaymentDate: iso("2026-01-15"),
    });
    const totals = calculateTotalCost(schedule);
    expect(schedule).toHaveLength(36);
    expect(totals.totalPrincipal.toFixed(2)).toBe("10000000.00");
    expect(totals.totalInterest.gt(0)).toBe(true);
    expect(schedule.at(-1)!.closingBalance.toFixed(2)).toBe("0.00");
  });

  it("cubre tasa cero con división exacta y sin interés", () => {
    const schedule = generateAmortizationSchedule({
      principal: "1200000",
      periodicRate: 0,
      numberOfInstallments: 12,
      firstPaymentDate: iso("2026-01-31"),
    });
    expect(schedule.every((row) => row.paymentAmount.eq("100000"))).toBe(true);
    expect(calculateTotalCost(schedule)).toMatchObject({
      totalPrincipal: d("1200000"),
      totalInterest: d(0),
      totalCost: d("1200000"),
    });
  });

  it("descompone la primera cuota entre interés, capital y saldo", () => {
    expect(
      calculateInstallment({
        openingBalance: "1000",
        periodicRate: "0.01",
        paymentAmount: "100",
      }),
    ).toEqual({
      interestAmount: d("10"),
      principalAmount: d("90"),
      paymentAmount: d("100"),
      closingBalance: d("910"),
    });
  });

  it("ajusta la última cuota y elimina residuos de redondeo", () => {
    const schedule = generateAmortizationSchedule({
      principal: "1000",
      periodicRate: "0.0137",
      numberOfInstallments: 7,
      firstPaymentDate: iso("2026-01-01"),
    });
    expect(schedule.at(-1)!.closingBalance.isZero()).toBe(true);
    expect(calculateTotalCost(schedule).totalPrincipal.eq("1000")).toBe(true);
  });

  it("mantiene invariantes en montos con decimales repetitivos", () => {
    const schedule = generateAmortizationSchedule({
      principal: "100",
      periodicRate: 0,
      numberOfInstallments: 3,
      firstPaymentDate: iso("2026-05-10"),
    });
    for (let index = 0; index < schedule.length; index += 1) {
      const row = schedule[index]!;
      expect(row.principalAmount.gte(0)).toBe(true);
      expect(row.interestAmount.gte(0)).toBe(true);
      expect(row.closingBalance.gte(0)).toBe(true);
      if (index > 0) expect(row.openingBalance.eq(schedule[index - 1]!.closingBalance)).toBe(true);
    }
    expect(
      schedule
        .map((row) => row.principalAmount)
        .reduce((a, b) => a.plus(b), d(0))
        .eq(100),
    ).toBe(true);
    expect(schedule.map((row) => row.paymentAmount.toFixed(2))).toEqual([
      "33.33",
      "33.33",
      "33.34",
    ]);
  });

  it.each([120, 240, 360])("amortiza plazos largos de %i cuotas", (numberOfInstallments) => {
    const schedule = generateAmortizationSchedule({
      principal: "250000000",
      periodicRate: "0.008",
      numberOfInstallments,
      firstPaymentDate: iso("2026-01-31"),
    });
    expect(schedule).toHaveLength(numberOfInstallments);
    expect(schedule.at(-1)!.closingBalance.isZero()).toBe(true);
    expect(calculateTotalCost(schedule).totalPrincipal.eq("250000000")).toBe(true);
  });

  it("maneja tasas muy bajas y tasas altas válidas", () => {
    expect(
      calculateFixedPayment({
        principal: 1000,
        periodicRate: "0.000000001",
        numberOfInstallments: 12,
      }).gt(0),
    ).toBe(true);
    expect(
      calculateFixedPayment({ principal: 1000, periodicRate: "0.5", numberOfInstallments: 12 }).gt(
        500,
      ),
    ).toBe(true);
  });

  it("rechaza una cuota que no cubre el interés", () => {
    expectCode(() => calculateNumberOfPeriods("1000", "0.1", "100"), "PAYMENT_TOO_LOW");
    expectCode(
      () =>
        generateAmortizationSchedule({
          principal: 1000,
          periodicRate: "0.1",
          numberOfInstallments: 12,
          paymentAmount: 100,
          firstPaymentDate: iso("2026-01-01"),
        }),
      "PAYMENT_TOO_LOW",
    );
  });

  it("preserva el día contractual y limita al último día del mes", () => {
    const first = iso("2025-01-31");
    expect(addContractMonths(first, 1).toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(addContractMonths(first, 2).toISOString()).toBe("2025-03-31T00:00:00.000Z");
    expect(addContractMonths(first, 3).toISOString()).toBe("2025-04-30T00:00:00.000Z");
    expect(addContractMonths(iso("2024-01-31"), 1).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(calculateEstimatedEndDate(first, 4).toISOString()).toBe("2025-04-30T00:00:00.000Z");
  });

  it("convierte correctamente tasas efectivas y nominales", () => {
    const monthly = convertInterestRate("0.24", "EFFECTIVE_ANNUAL", "EFFECTIVE_MONTHLY");
    expect(monthly.toFixed(12)).toBe("0.018087582484");
    expect(convertInterestRate(monthly, "EFFECTIVE_MONTHLY", "EFFECTIVE_ANNUAL").toFixed(10)).toBe(
      "0.2400000000",
    );
    expect(convertInterestRate("0.24", "NOMINAL_ANNUAL", "EFFECTIVE_MONTHLY").toFixed(2)).toBe(
      "0.02",
    );
    expect(convertInterestRate(0, "EFFECTIVE_ANNUAL", "EFFECTIVE_MONTHLY").isZero()).toBe(true);
  });

  it("calcula saldo, capital e intereses pagados y restantes", () => {
    const schedule = generateAmortizationSchedule({
      principal: "5000000",
      periodicRate: "0.012",
      numberOfInstallments: 24,
      firstPaymentDate: iso("2026-01-20"),
    });
    expect(calculateRemainingBalance(schedule, 12).eq(schedule[11]!.closingBalance)).toBe(true);
    expect(
      calculatePaidPrincipal(schedule, 12)
        .plus(calculateRemainingBalance(schedule, 12))
        .eq("5000000"),
    ).toBe(true);
    expect(calculatePaidInterest(schedule, 12).gt(0)).toBe(true);
    expect(calculateRemainingInterest(schedule, 12).gt(0)).toBe(true);
    expect(calculateRemainingInstallments(schedule, 12)).toBe(12);
  });

  it("suma el costo real incluyendo seguros y cargos", () => {
    const totals = calculateTotalCost(
      generateAmortizationSchedule({
        principal: 1200,
        periodicRate: 0,
        numberOfInstallments: 12,
        firstPaymentDate: iso("2026-01-01"),
        insuranceAmount: 5,
        feeAmount: 2,
      }),
    );
    expect(totals).toEqual({
      totalPrincipal: d(1200),
      totalInterest: d(0),
      totalInsurance: d(60),
      totalFees: d(24),
      totalCost: d(1284),
    });
  });

  it("calcula número de periodos sin depender de base de datos", () => {
    expect(calculateNumberOfPeriods(1200, 0, 100)).toBe(12);
    expect(calculateNumberOfPeriods(1000, "0.01", 100)).toBe(11);
  });

  it.each([
    ["WEEKLY", "2026-01-22T00:00:00.000Z"],
    ["MONTHLY", "2026-02-15T00:00:00.000Z"],
    ["BIMONTHLY", "2026-03-15T00:00:00.000Z"],
    ["SEMIANNUAL", "2026-07-15T00:00:00.000Z"],
  ] as const)("genera vencimientos reales para frecuencia %s", (frequency, expected) => {
    expect(addContractPeriods(iso("2026-01-15"), 1, frequency).toISOString()).toBe(expected);
    const schedule = generateAmortizationSchedule({
      principal: 1000,
      periodicRate: 0,
      numberOfInstallments: 2,
      firstPaymentDate: iso("2026-01-15"),
      paymentFrequency: frequency,
    });
    expect(schedule[1]!.dueDate.toISOString()).toBe(expected);
  });

  it("convierte la tasa mensual a la periodicidad", () => {
    expect(toEffectivePeriodic("0.02", "EFFECTIVE_MONTHLY", "MONTHLY").toFixed(2)).toBe("0.02");
    expect(toEffectivePeriodic("0.02", "EFFECTIVE_MONTHLY", "BIMONTHLY").toFixed(4)).toBe("0.0404");
    expect(toEffectivePeriodic("0.02", "EFFECTIVE_MONTHLY", "WEEKLY").toFixed(12)).toBe(
      "0.004580294698",
    );
    expect(toEffectivePeriodic("0.02", "EFFECTIVE_MONTHLY", "SEMIANNUAL").toFixed(12)).toBe(
      "0.126162419264",
    );
  });

  it.each([
    [
      () => calculateFixedPayment({ principal: -1, periodicRate: 0, numberOfInstallments: 1 }),
      "INVALID_PRINCIPAL",
    ],
    [
      () => calculateFixedPayment({ principal: 1, periodicRate: -1, numberOfInstallments: 1 }),
      "INVALID_RATE",
    ],
    [
      () => calculateFixedPayment({ principal: 1, periodicRate: 0, numberOfInstallments: 0 }),
      "INVALID_TERM",
    ],
    [() => calculateNumberOfPeriods(1, 0, 0), "INVALID_PAYMENT"],
    [
      () =>
        calculateFixedPayment({ principal: Number.NaN, periodicRate: 0, numberOfInstallments: 1 }),
      "INVALID_PRINCIPAL",
    ],
    [
      () =>
        calculateFixedPayment({
          principal: 1,
          periodicRate: Number.POSITIVE_INFINITY,
          numberOfInstallments: 1,
        }),
      "INVALID_RATE",
    ],
  ] as const)("rechaza entradas matemáticamente inválidas", (operation, expectedCode) => {
    expectCode(operation, expectedCode);
  });
});
