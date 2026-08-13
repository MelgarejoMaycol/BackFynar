import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  CreditMathError,
  calculateFixedPayment,
  estimateCredit,
  solvePeriodicRate,
} from "../src/modules/debts/domain/index.js";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("estimador de créditos", () => {
  it("resuelve monto + tasa + plazo a cuota EXACT", () => {
    const result = estimateCredit({
      originalPrincipal: "10000000",
      periodicRate: "0.01",
      totalInstallments: 36,
      firstPaymentDate: date("2026-09-30"),
    });
    expect(result.paymentAmount.value!.toFixed(2)).toBe("332143.10");
    expect(result.paymentAmount).toMatchObject({ source: "CALCULATED", quality: "EXACT" });
    expect(result.overallQuality).toBe("EXACT");
    expect(result.estimatedSchedule).toHaveLength(36);
  });

  it("reconstruye la tasa desde monto + cuota + plazo", () => {
    const expectedRate = new Prisma.Decimal("0.0125");
    const payment = calculateFixedPayment({
      principal: "8000000",
      periodicRate: expectedRate,
      numberOfInstallments: 48,
    });
    const result = estimateCredit({
      originalPrincipal: "8000000",
      paymentAmount: payment,
      totalInstallments: 48,
    });
    expect(result.periodicRate.source).toBe("ESTIMATED");
    expect(result.periodicRate.quality).toBe("HIGH_ESTIMATE");
    expect(result.periodicRate.value!.minus(expectedRate).abs().lte("0.0000001")).toBe(true);
  });

  it("detecta tasa implícita cero", () => {
    const result = estimateCredit({
      originalPrincipal: 1200,
      paymentAmount: 100,
      totalInstallments: 12,
    });
    expect(result.periodicRate.value!.isZero()).toBe(true);
  });

  it("usa saldo actual para estimar cuotas restantes", () => {
    const result = estimateCredit({
      currentBalance: 6200000,
      periodicRate: "0.01",
      paymentAmount: 420000,
    });
    expect(result.remainingInstallments.value).toBe(17);
    expect(result.totalInstallments.value).toBeNull();
    expect(result.remainingInstallments.derivedFrom).toContain("currentBalance");
  });

  it("resuelve monto + tasa + cuota a plazo", () => {
    const payment = calculateFixedPayment({
      principal: 5000000,
      periodicRate: "0.012",
      numberOfInstallments: 24,
    });
    const result = estimateCredit({
      originalPrincipal: 5000000,
      periodicRate: "0.012",
      paymentAmount: payment,
    });
    expect(result.totalInstallments.value).toBe(24);
    expect(result.totalInstallments.source).toBe("ESTIMATED");
  });

  it("devuelve INSUFFICIENT_DATA sin inventar valores", () => {
    const result = estimateCredit({ originalPrincipal: 10000000 });
    expect(result.overallQuality).toBe("INSUFFICIENT_DATA");
    expect(result.issues).toEqual(["INSUFFICIENT_DATA"]);
    expect(result.paymentAmount.value).toBeNull();
    expect(result.periodicRate.value).toBeNull();
  });

  it("detecta cuota demasiado baja para amortizar", () => {
    const result = estimateCredit({
      currentBalance: 10000000,
      periodicRate: "0.02",
      paymentAmount: 100000,
    });
    expect(result.issues).toContain("PAYMENT_TOO_LOW");
    expect(result.overallQuality).toBe("INSUFFICIENT_DATA");
  });

  it("detecta datos principales contradictorios", () => {
    const result = estimateCredit({
      originalPrincipal: 10000000,
      periodicRate: "0.015",
      totalInstallments: 24,
      paymentAmount: 50000,
    });
    expect(result.issues).toContain("INCONSISTENT_INPUT");
    expect(result.paymentComparison?.consistent).toBe(false);
    expect(result.paymentAmount.value!.eq(50000)).toBe(true);
    expect(result.estimatedSchedule).toBeNull();
  });

  it("tolera una diferencia pequeña de redondeo sin sobrescribir la cuota", () => {
    const calculated = calculateFixedPayment({
      principal: 10000,
      periodicRate: "0.01",
      numberOfInstallments: 12,
    });
    const provided = calculated.plus("0.01");
    const result = estimateCredit({
      originalPrincipal: 10000,
      periodicRate: "0.01",
      totalInstallments: 12,
      paymentAmount: provided,
    });
    expect(result.paymentComparison?.consistent).toBe(true);
    expect(result.paymentAmount.value!.eq(provided)).toBe(true);
    expect(result.issues).not.toContain("INCONSISTENT_INPUT");
  });

  it("marca diferencia significativa entre cuota informada y matemática", () => {
    const result = estimateCredit({
      originalPrincipal: 100000,
      periodicRate: "0.01",
      totalInstallments: 12,
      paymentAmount: 20000,
    });
    expect(result.paymentComparison!.absoluteDifference.gt(10000)).toBe(true);
    expect(result.paymentComparison!.percentageDifference.gt(100)).toBe(true);
    expect(result.overallQuality).toBe("LOW_ESTIMATE");
  });

  it("calcula fecha final solo cuando existe fecha inicial", () => {
    const withDate = estimateCredit({
      originalPrincipal: 1200,
      periodicRate: 0,
      totalInstallments: 12,
      firstPaymentDate: date("2026-01-31"),
    });
    expect(withDate.estimatedEndDate.value!.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    const withoutDate = estimateCredit({
      originalPrincipal: 1200,
      periodicRate: 0,
      totalInstallments: 12,
    });
    expect(withoutDate.estimatedEndDate.value).toBeNull();
  });

  it("deduce cuotas restantes exactamente de total menos pagadas", () => {
    const result = estimateCredit({ totalInstallments: 36, installmentsPaid: 12 });
    expect(result.remainingInstallments).toMatchObject({
      value: 24,
      source: "CALCULATED",
      quality: "EXACT",
    });
  });

  it("soporta 360 meses y tasas muy bajas o altas", () => {
    for (const periodicRate of ["0.0000001", "0.25"]) {
      const result = estimateCredit({
        originalPrincipal: 250000000,
        periodicRate,
        totalInstallments: 360,
      });
      expect(result.paymentAmount.value!.gt(0)).toBe(true);
      expect(result.overallQuality).toBe("EXACT");
    }
  });

  it("solver respeta tolerancia y límites explícitos", () => {
    const payment = calculateFixedPayment({
      principal: 1000000,
      periodicRate: "0.00875",
      numberOfInstallments: 60,
    });
    const solved = solvePeriodicRate({
      principal: 1000000,
      paymentAmount: payment,
      numberOfInstallments: 60,
      maxIterations: 200,
      rateTolerance: "0.000000000001",
    });
    expect(solved.minus("0.00875").abs().lte("0.0000001")).toBe(true);
  });

  it("solver rechaza ausencia de solución y falta de convergencia", () => {
    expect(() =>
      solvePeriodicRate({ principal: 10000000, paymentAmount: 100000, numberOfInstallments: 12 }),
    ).toThrowError(CreditMathError);
    expect(() =>
      solvePeriodicRate({
        principal: 1000,
        paymentAmount: 200,
        numberOfInstallments: 12,
        maxIterations: 1,
        moneyTolerance: "0.0000001",
        rateTolerance: "0.000000000000000001",
      }),
    ).toThrowError(CreditMathError);
  });

  it("recupera inversamente el plazo esperado", () => {
    const payment = calculateFixedPayment({
      principal: 9000000,
      periodicRate: "0.011",
      numberOfInstallments: 72,
    });
    expect(
      estimateCredit({ originalPrincipal: 9000000, periodicRate: "0.011", paymentAmount: payment })
        .totalInstallments.value,
    ).toBe(72);
  });

  it("conserva el input sin mutarlo y expone supuestos", () => {
    const input = Object.freeze({
      originalPrincipal: "1000",
      paymentAmount: "100",
      totalInstallments: 12,
    });
    const snapshot = JSON.stringify(input);
    const result = estimateCredit(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.originalPrincipal.source).toBe("PROVIDED");
    expect(result.assumptions).toContain("FIXED_PAYMENT_AMORTIZATION");
    expect(result.assumptions).toContain("NO_UNMODELED_FEES_OR_INSURANCE");
  });

  it("valida relaciones entre cuotas", () => {
    expect(() => estimateCredit({ totalInstallments: 12, installmentsPaid: 13 })).toThrowError(
      CreditMathError,
    );
  });
});
