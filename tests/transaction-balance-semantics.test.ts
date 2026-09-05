import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  assertLiabilityPaymentWithinBalance,
  assertCardPurchaseWithinLimit,
  assertSufficientTransferFunds,
  balanceDeltas,
  TransactionsService,
} from "../src/modules/transactions/transactions.service.js";

describe("semántica contable por naturaleza", () => {
  it("paga un pasivo mediante transferencia sin crear un ingreso", () => {
    const amount = new Prisma.Decimal("240000.00");
    const result = balanceDeltas("TRANSFER", amount, "ASSET", "LIABILITY");
    expect(result.sourceDelta.toFixed(2)).toBe("-240000.00");
    expect(result.destinationDelta?.toFixed(2)).toBe("-240000.00");
    expect(new Prisma.Decimal("824543.22").plus(result.destinationDelta!).toFixed(2)).toBe(
      "584543.22",
    );
  });

  it("revierte exactamente el pago del pasivo", () => {
    const result = balanceDeltas(
      "TRANSFER",
      new Prisma.Decimal("-240000.00"),
      "ASSET",
      "LIABILITY",
    );
    expect(new Prisma.Decimal("584543.22").plus(result.destinationDelta!).toFixed(2)).toBe(
      "824543.22",
    );
  });

  it("incrementa la deuda cuando el gasto se hace desde un pasivo", () => {
    const result = balanceDeltas("EXPENSE", new Prisma.Decimal("100.00"), "LIABILITY");
    expect(result.sourceDelta.toFixed(2)).toBe("100.00");
  });

  it("bloquea compras que superan el cupo disponible de la tarjeta", () => {
    expect(() =>
      assertCardPurchaseWithinLimit(
        new Prisma.Decimal("568000"),
        new Prisma.Decimal("800000"),
        new Prisma.Decimal("1000000"),
      ),
    ).toThrow("Cupo insuficiente");
    expect(() =>
      assertCardPurchaseWithinLimit(
        new Prisma.Decimal("150000"),
        new Prisma.Decimal("800000"),
        new Prisma.Decimal("1000000"),
      ),
    ).not.toThrow();
  });

  it("incrementa un activo y reduce una tarjeta al registrar ingresos", () => {
    expect(
      balanceDeltas("INCOME", new Prisma.Decimal("100000"), "ASSET").sourceDelta.toFixed(2),
    ).toBe("100000.00");
    expect(
      balanceDeltas("INCOME", new Prisma.Decimal("100000"), "LIABILITY").sourceDelta.toFixed(2),
    ).toBe("-100000.00");
    expect(() =>
      assertLiabilityPaymentWithinBalance(
        new Prisma.Decimal("150000"),
        new Prisma.Decimal("100000"),
      ),
    ).toThrow("Pago superior al saldo pendiente");
  });

  it("Ingreso a tarjeta crea un solo movimiento y aplica una sola reducción", async () => {
    const card = {
      id: "card",
      workspaceId: "workspace",
      name: "Credi Tarjeta",
      type: "CREDIT_CARD",
      nature: "LIABILITY",
      currency: "COP",
      currentBalance: new Prisma.Decimal("300000"),
      creditLimit: new Prisma.Decimal("1500000"),
      isActive: true,
      deletedAt: null,
    };
    const transactionCreate = vi.fn().mockResolvedValue({
      id: "movement",
      type: "INCOME",
      status: "CONFIRMED",
      amount: new Prisma.Decimal("100000"),
      currency: "COP",
      accountId: "card",
      destinationAccountId: null,
      categoryId: "category",
      occurredAt: new Date("2026-08-20T16:00:00Z"),
      description: null,
      notes: null,
      merchantName: null,
      metadata: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const accountUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      financialAccount: { findMany: vi.fn().mockResolvedValue([card]), update: accountUpdate },
      issuedLoan: { findFirst: vi.fn().mockResolvedValue(null) },
      category: { findFirst: vi.fn().mockResolvedValue({ id: "category" }) },
      workspace: { findUnique: vi.fn().mockResolvedValue({ timezone: "America/Bogota" }) },
      transaction: { create: transactionCreate },
    };
    const repository = { transaction: vi.fn((operation) => operation(tx)), lockAccounts: vi.fn() };
    const service = new TransactionsService(repository as never);
    await service.income("workspace", "user", {
      accountId: "card",
      categoryId: "category",
      amount: "100000",
      occurredAt: "2026-08-20T16:00:00.000Z",
    });
    expect(transactionCreate).toHaveBeenCalledTimes(1);
    expect(accountUpdate).toHaveBeenCalledTimes(1);
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: "card" },
      data: { currentBalance: { increment: new Prisma.Decimal("-100000") } },
    });
  });

  it("bloquea un pago que convertiría el pasivo en saldo a favor", () => {
    expect(() =>
      assertLiabilityPaymentWithinBalance(
        new Prisma.Decimal("900000.00"),
        new Prisma.Decimal("824543.22"),
      ),
    ).toThrow("Pago superior al saldo pendiente");
  });

  it("calcula el caso Nequi a tarjeta y bloquea fondos insuficientes", () => {
    const deltas = balanceDeltas("TRANSFER", new Prisma.Decimal("250000.00"), "ASSET", "LIABILITY");
    expect(new Prisma.Decimal("264000.00").plus(deltas.sourceDelta).toFixed(2)).toBe("14000.00");
    expect(new Prisma.Decimal("824543.22").plus(deltas.destinationDelta!).toFixed(2)).toBe(
      "574543.22",
    );
    expect(() =>
      assertSufficientTransferFunds(
        new Prisma.Decimal("300000.00"),
        new Prisma.Decimal("264000.00"),
      ),
    ).toThrow("Fondos insuficientes");
  });
});
