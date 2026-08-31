import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/database/prisma.js";
import { PersonalBalancesService } from "../../src/modules/personal-balances/personal-balances.service.js";

describe.sequential("deudas y cobros integrados con cuentas", () => {
  const service = new PersonalBalancesService(prisma);
  const suffix = randomUUID().replaceAll("-", "");
  let userId = "";
  let workspaceId = "";
  let otherWorkspaceId = "";
  let accountId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `qa-personal-${suffix}@example.com`, firstName: "QA" },
    });
    userId = user.id;
    const workspace = await prisma.workspace.create({
      data: { name: "QA personal", ownerUserId: userId },
    });
    const other = await prisma.workspace.create({
      data: { name: "QA other", ownerUserId: userId },
    });
    workspaceId = workspace.id;
    otherWorkspaceId = other.id;
    const account = await prisma.financialAccount.create({
      data: {
        workspaceId,
        name: "Bancolombia QA",
        type: "CHECKING",
        nature: "ASSET",
        currency: "COP",
        openingBalance: "1000000.00",
        currentBalance: "1000000.00",
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    if (workspaceId || otherWorkspaceId) {
      await prisma.personalBalanceEntry.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
      await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("paga, crea un único gasto y revierte toda la operación atómicamente", async () => {
    const person = await service.createPerson(workspaceId, userId, {
      name: "Carlos Gómez",
      relationship: "Hermano",
    });
    const balance = await service.create(workspaceId, userId, {
      personId: person.id,
      direction: "PAYABLE",
      amount: "500000.00",
      currency: "COP",
    });
    const paid = await service.addEntry(workspaceId, userId, balance.id, {
      type: "PAYMENT",
      amount: "100000.00",
      accountId,
    });
    const payment = paid.entries.find((entry) => entry.type === "PAYMENT")!;
    expect(paid.currentBalance).toBe("400000.00");
    expect(payment.accountName).toBe("Bancolombia QA");
    expect((await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2)).toBe("900000.00");
    expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: payment.transactionId! } })).description).toBe("Pago de deuda · Carlos Gómez");

    expect((await service.list(workspaceId, { direction: "PAYABLE" })).map(({ id }) => id)).toContain(balance.id);

    const settled = await service.addEntry(workspaceId, userId, balance.id, {
      type: "PAYMENT", amount: "400000.00", accountId,
      occurredAt: "2026-08-31T15:00:00-05:00",
    });
    const finalPayment = settled.entries.find((entry) => entry.type === "PAYMENT" && entry.id !== payment.id)!;
    expect(settled).toMatchObject({ currentBalance: "0.00", status: "SETTLED" });
    expect(settled.settledAt).toBe("2026-08-31T20:00:00.000Z");
    expect(settled.entries).toHaveLength(3);
    expect((await service.list(workspaceId, {})).map(({ id }) => id)).not.toContain(balance.id);
    expect((await service.list(workspaceId, { direction: "PAYABLE" })).map(({ id }) => id)).not.toContain(balance.id);
    expect((await service.list(workspaceId, { status: "SETTLED" })).map(({ id }) => id)).toContain(balance.id);
    expect((await service.summary(workspaceId)).currencies.find(({ currency }) => currency === "COP")?.iOwe).toBe("0.00");

    const reversed = await service.reverseEntry(workspaceId, userId, balance.id, finalPayment.id);
    expect(reversed).toMatchObject({ currentBalance: "400000.00", status: "PARTIAL", settledAt: null });
    expect((await service.list(workspaceId, { direction: "PAYABLE" })).map(({ id }) => id)).toContain(balance.id);
    expect((await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2)).toBe("900000.00");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: finalPayment.transactionId! } })).status).toBe("CANCELLED");
  });

  it("recibe un cobro, aumenta la cuenta y conserva lo pagado al editar el original", async () => {
    const person = await service.createPerson(workspaceId, userId, { name: "Juan Pérez" });
    const balance = await service.create(workspaceId, userId, {
      personId: person.id,
      direction: "RECEIVABLE",
      amount: "500000.00",
      currency: "COP",
    });
    const collected = await service.addEntry(workspaceId, userId, balance.id, {
      type: "PAYMENT",
      amount: "150000.00",
      accountId,
    });
    expect(collected.currentBalance).toBe("350000.00");
    expect((await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2)).toBe("1050000.00");
    expect((await service.update(workspaceId, balance.id, { originalAmount: "600000.00" })).currentBalance).toBe("450000.00");
    await expect(service.update(workspaceId, balance.id, { originalAmount: "100000.00" })).rejects.toThrow(/menor/);
  });

  it("rechaza personas ajenas y cuentas archivadas", async () => {
    const outsider = await service.createPerson(otherWorkspaceId, userId, { name: "Ajeno" });
    await expect(service.create(workspaceId, userId, {
      personId: outsider.id,
      direction: "PAYABLE",
      amount: "100.00",
      currency: "COP",
    })).rejects.toThrow(/Persona/);
    await prisma.financialAccount.update({ where: { id: accountId }, data: { isActive: false } });
    const person = await service.createPerson(workspaceId, userId, { name: "Pedro" });
    const balance = await service.create(workspaceId, userId, {
      personId: person.id,
      direction: "PAYABLE",
      amount: "100.00",
      currency: "COP",
    });
    await expect(service.addEntry(workspaceId, userId, balance.id, {
      type: "PAYMENT", amount: "50.00", accountId,
    })).rejects.toThrow(/Cuenta activa/);
  });
});
