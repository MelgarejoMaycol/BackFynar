import { describe, expect, it } from "vitest";
import {
  cardPaymentExpectationSchema,
  cashAdvanceSchema,
  createCardSchema,
  purchaseSchema,
  statementSchema,
} from "../src/modules/cards/cards.schemas.js";
import {
  createDebtSchema,
  paymentSchema,
  prepaymentSchema,
} from "../src/modules/debts/debts.schemas.js";
import { LiabilitiesService } from "../src/modules/liabilities/liabilities.service.js";
import {
  createObligationSchema,
  reverseOccurrencePaymentSchema,
  updateOccurrencePaymentSchema,
} from "../src/modules/obligations/obligations.schemas.js";
describe("contratos de pasivos 9D-9M", () => {
  it("acepta un próximo pago informado sin inventar datos de extracto", () => {
    expect(cardPaymentExpectationSchema.parse({ amount: "180000", dueDate: "2026-09-05" })).toEqual(
      { amount: "180000", dueDate: "2026-09-05" },
    );
  });
  it("conserva el pago mínimo opcional y rechaza un saldo total ambiguo", () => {
    const value = cardPaymentExpectationSchema.parse({
      amount: "180000",
      minimumPayment: "75000",
      dueDate: "2026-09-05",
    });
    expect(value.minimumPayment).toBe("75000");
    expect(() =>
      cardPaymentExpectationSchema.parse({
        amount: "180000",
        reportedTotalBalance: "608543.22",
        dueDate: "2026-09-05",
      }),
    ).toThrow();
  });
  it("acepta crédito parcial", () =>
    expect(
      createDebtSchema.parse({
        name: "Crédito",
        type: "BANK_LOAN",
        currency: "COP",
        originalAmount: "1000000",
      }).originalAmount,
    ).toBe("1000000"));
  it("rechaza dinero flotante", () =>
    expect(() =>
      createDebtSchema.parse({
        name: "X",
        type: "BANK_LOAN",
        currency: "COP",
        originalAmount: "NaN",
      }),
    ).toThrow());
  it("exige idempotencia del pago", () => expect(() => paymentSchema.parse({})).toThrow());
  it("permite que el backend calcule el desglose del pago", () =>
    expect(
      paymentSchema.parse({
        accountId: "00000000-0000-4000-8000-000000000001",
        amount: "100.00",
        paidAt: "2026-08-12T12:00:00Z",
        idempotencyKey: "payment-auto-1",
      }).principalAmount,
    ).toBeUndefined());
  it("acepta pago y abono externos sin inventar una cuenta origen", () => {
    expect(
      paymentSchema.parse({
        amount: "100.00",
        paidAt: "2026-08-12T12:00:00Z",
        idempotencyKey: "external-payment-1",
      }).accountId,
    ).toBeUndefined();
    expect(
      prepaymentSchema.parse({
        amount: "100.00",
        strategy: "REDUCE_PAYMENT",
        occurredAt: "2026-08-12T12:00:00Z",
        idempotencyKey: "external-prepayment-1",
      }).accountId,
    ).toBeUndefined();
  });
  it("distingue modalidades de abono", () =>
    expect(prepaymentSchema.parse({ amount: "100", strategy: "REDUCE_TERM" }).strategy).toBe(
      "REDUCE_TERM",
    ));
  it("valida correcciones y reversiones versionadas de pagos de obligación", () => {
    expect(
      updateOccurrencePaymentSchema.parse({
        accountId: "00000000-0000-4000-8000-000000000001",
        amount: "80000.00",
        version: 2,
      }),
    ).toMatchObject({ amount: "80000.00", version: 2 });
    expect(() => updateOccurrencePaymentSchema.parse({ version: 1 })).toThrow();
    expect(
      reverseOccurrencePaymentSchema.parse({ reason: "Cuenta incorrecta", version: 3 }),
    ).toEqual({ reason: "Cuenta incorrecta", version: 3 });
  });
  it("valida obligación variable", () =>
    expect(
      createObligationSchema.parse({
        name: "Energía",
        expectedAmount: "100",
        currency: "COP",
        amountType: "VARIABLE",
        frequency: "MONTHLY",
        startsOn: "2026-08-01",
      }).amountType,
    ).toBe("VARIABLE"));
  it("devuelve solo el próximo pago accionable por recurso", async () => {
    const service = new LiabilitiesService({
      debtInstallment: {
        findMany: async () => [
          {
            id: "i-1",
            debtId: "debt-1",
            dueDate: new Date("2026-08-05T00:00:00Z"),
            totalAmount: { minus: () => ({ toFixed: () => "100000.00" }) },
            paidAmount: "0",
            status: "PENDING",
            debts: { name: "Crédito banco", currency: "COP" },
          },
          {
            id: "i-2",
            debtId: "debt-1",
            dueDate: new Date("2026-08-20T00:00:00Z"),
            totalAmount: { minus: () => ({ toFixed: () => "120000.00" }) },
            paidAmount: "0",
            status: "PENDING",
            debts: { name: "Crédito banco", currency: "COP" },
          },
        ],
      },
      obligationOccurrence: {
        findMany: async () => [
          {
            id: "o-1",
            obligationId: "ob-1",
            dueDate: new Date("2026-08-10T00:00:00Z"),
            amount: { minus: () => ({ toFixed: () => "150000.00" }) },
            paidAmount: "0",
            status: "PENDING",
            obligation: { name: "Internet", currency: "COP" },
          },
          {
            id: "o-2",
            obligationId: "ob-1",
            dueDate: new Date("2026-08-25T00:00:00Z"),
            amount: { minus: () => ({ toFixed: () => "150000.00" }) },
            paidAmount: "0",
            status: "PENDING",
            obligation: { name: "Internet", currency: "COP" },
          },
        ],
      },
      cardStatement: { findMany: async () => [] },
      cardPaymentExpectation: { findMany: async () => [] },
      financialAccount: { findMany: async () => [] },
      workspace: { findUnique: async () => ({ timezone: "UTC" }) },
    } as never);
    const items = await service.upcoming("workspace-1", new Date("2026-08-01T00:00:00Z"));
    expect(items.map((item) => item.resourceId)).toEqual(["debt-1", "ob-1"]);
    expect(items[0]).toMatchObject({ id: "i-1", resourceId: "debt-1" });
    expect(items[1]).toMatchObject({ id: "o-1", resourceId: "ob-1" });
  });
  it("acepta compra de una cuota", () =>
    expect(
      purchaseSchema.parse({
        amount: "100",
        categoryId: "00000000-0000-4000-8000-000000000001",
        occurredAt: "2026-08-12T12:00:00Z",
        description: "Compra",
        firstDueDate: "2026-09-01",
        idempotencyKey: "purchase-1",
      }).installmentCount,
    ).toBe(1));
  it("rechaza periodo de extracto inválido en formato", () =>
    expect(() =>
      statementSchema.parse({ periodStart: "hoy", periodEnd: "2026-08-31", dueDate: "2026-09-10" }),
    ).toThrow());
  it("crea una tarjeta informando solo el cupo disponible", () =>
    expect(
      createCardSchema.parse({
        name: "Visa",
        currency: "COP",
        creditLimit: "5000000",
        availableCredit: "4200000",
      }).availableCredit,
    ).toBe("4200000"));
  it("rechaza cupos disponibles o utilizados superiores al total", () =>
    expect(() =>
      createCardSchema.parse({
        name: "Visa",
        currency: "COP",
        creditLimit: "100",
        usedCredit: "101",
      }),
    ).toThrow());
  it("valida el contrato de avance y exige un monto positivo", () => {
    const base = {
      destinationAccountId: "00000000-0000-4000-8000-000000000001",
      occurredAt: "2026-08-12T12:00:00Z",
      idempotencyKey: "advance-1",
    };
    expect(cashAdvanceSchema.parse({ ...base, amount: "250000" }).feeAmount).toBe("0");
    expect(() => cashAdvanceSchema.parse({ ...base, amount: "0" })).toThrow();
  });
});
