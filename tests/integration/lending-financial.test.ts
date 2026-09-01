import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/database/prisma.js";
import { LendingService } from "../../src/modules/lending/lending.service.js";

describe.sequential("préstamos emitidos integrados con personas, cuentas y movimientos", () => {
  const service = new LendingService(prisma);
  const suffix = randomUUID().replaceAll("-", "");
  let userId = "";
  let workspaceId = "";
  let otherWorkspaceId = "";
  let personId = "";
  let sourceId = "";
  let receivingId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `qa-lending-${suffix}@example.com`, firstName: "QA" } });
    userId = user.id;
    workspaceId = (await prisma.workspace.create({ data: { name: "QA lending", ownerUserId: userId } })).id;
    otherWorkspaceId = (await prisma.workspace.create({ data: { name: "QA other lending", ownerUserId: userId } })).id;
    personId = (await prisma.financialPerson.create({ data: { workspaceId, createdBy: userId, name: "Ana Préstamos" } })).id;
    sourceId = (await prisma.financialAccount.create({ data: { workspaceId, name: "Origen", type: "CHECKING", nature: "ASSET", currency: "COP", openingBalance: "1000000", currentBalance: "1000000" } })).id;
    receivingId = (await prisma.financialAccount.create({ data: { workspaceId, name: "Recaudos", type: "SAVINGS", nature: "ASSET", currency: "COP", openingBalance: 0, currentBalance: 0 } })).id;
  });

  afterAll(async () => {
    if (workspaceId) {
      await prisma.$executeRaw`DELETE FROM issued_loan_payments WHERE workspace_id=${workspaceId}::uuid`;
      await prisma.$executeRaw`DELETE FROM issued_loans WHERE workspace_id=${workspaceId}::uuid`;
    }
    if (workspaceId || otherWorkspaceId) await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    personId, principal: 120000, ratePercent: 10, termCount: 2,
    method: "FIXED_PRINCIPAL" as const, frequency: "MONTHLY" as const,
    currency: "COP", sourceAccountId: null, disbursementDate: "2026-08-31",
    firstPaymentDate: "2026-09-30", notes: null, ...overrides,
  });

  it("crea un préstamo histórico con FinancialPerson y una cuenta por cobrar", async () => {
    const loan = await service.create(workspaceId, userId, input());
    expect(loan).toMatchObject({ personId, personName: "Ana Préstamos", status: "ACTIVE" });
    expect(Number(loan.currentPrincipal)).toBe(120000);
    expect(loan.installments).toHaveLength(2);
    const receivable = await prisma.financialAccount.findUniqueOrThrow({ where: { id: loan.receivableAccountId as string } });
    expect(receivable).toMatchObject({ nature: "ASSET", type: "LOAN", includeInNetWorth: true });
    expect(receivable.currentBalance.toFixed(2)).toBe("120000.00");
    expect(await prisma.transaction.count({ where: { workspaceId, metadata: { path: ["role"], equals: "DISBURSEMENT" } } })).toBe(0);
  });

  it("desembolsa desde una cuenta como transferencia y conserva el patrimonio", async () => {
    const before = await prisma.financialAccount.aggregate({ where: { workspaceId, nature: "ASSET", includeInNetWorth: true }, _sum: { currentBalance: true } });
    const loan = await service.create(workspaceId, userId, input({ principal: 200000, ratePercent: 0, sourceAccountId: sourceId }));
    const source = await prisma.financialAccount.findUniqueOrThrow({ where: { id: sourceId } });
    const receivable = await prisma.financialAccount.findUniqueOrThrow({ where: { id: loan.receivableAccountId as string } });
    const after = await prisma.financialAccount.aggregate({ where: { workspaceId, nature: "ASSET", includeInNetWorth: true }, _sum: { currentBalance: true } });
    expect(source.currentBalance.toFixed(2)).toBe("800000.00");
    expect(receivable.currentBalance.toFixed(2)).toBe("200000.00");
    expect(after._sum.currentBalance?.toFixed(2)).toBe(before._sum.currentBalance?.toFixed(2));
    const movement = await prisma.transaction.findFirstOrThrow({ where: { workspaceId, destinationAccountId: receivable.id } });
    expect(movement).toMatchObject({ type: "TRANSFER", accountId: sourceId, amount: expect.anything() });
  });

  it("rechaza persona, cuenta y moneda fuera de las reglas multiworkspace", async () => {
    const outsider = await prisma.financialPerson.create({ data: { workspaceId: otherWorkspaceId, createdBy: userId, name: "Ajena" } });
    const outsideAccount = await prisma.financialAccount.create({ data: { workspaceId: otherWorkspaceId, name: "Ajena", type: "CASH", nature: "ASSET", currentBalance: 1000 } });
    await expect(service.create(workspaceId, userId, input({ personId: outsider.id }))).rejects.toThrow(/Persona/);
    await expect(service.create(workspaceId, userId, input({ sourceAccountId: outsideAccount.id }))).rejects.toThrow(/Cuenta/);
    await expect(service.create(workspaceId, userId, input({ sourceAccountId: sourceId, currency: "USD" }))).rejects.toThrow(/moneda/);
    await prisma.financialAccount.update({ where: { id: sourceId }, data: { isActive: false } });
    await expect(service.create(workspaceId, userId, input({ sourceAccountId: sourceId }))).rejects.toThrow(/Cuenta/);
    await prisma.financialAccount.update({ where: { id: sourceId }, data: { isActive: true } });
  });

  it("aplica cobro parcial primero a interés; capital no es ingreso", async () => {
    const loan = await service.create(workspaceId, userId, input());
    const installment = loan.installments[0]!;
    const beforeReceiving = (await prisma.financialAccount.findUniqueOrThrow({ where: { id: receivingId } })).currentBalance;
    const beforeReceivable = (await prisma.financialAccount.findUniqueOrThrow({ where: { id: loan.receivableAccountId as string } })).currentBalance;
    const result = await service.pay(workspaceId, userId, loan.id as string, installment.id as string, { amount: 20000, receivingAccountId: receivingId, idempotencyKey: randomUUID() });
    const payment = result.payments.find((item: Record<string, unknown>) => item.id === result.paymentId)!;
    expect(Number(payment.interestReceived)).toBe(12000);
    expect(Number(payment.principalReceived)).toBe(8000);
    expect((await prisma.financialAccount.findUniqueOrThrow({ where: { id: receivingId } })).currentBalance.minus(beforeReceiving).toFixed(2)).toBe("20000.00");
    expect(beforeReceivable.minus((await prisma.financialAccount.findUniqueOrThrow({ where: { id: loan.receivableAccountId as string } })).currentBalance).toFixed(2)).toBe("8000.00");
    expect(await prisma.transaction.count({ where: { workspaceId, type: "INCOME", amount: "12000" } })).toBe(1);
    expect(await prisma.transaction.count({ where: { workspaceId, type: "INCOME", amount: "8000" } })).toBe(0);
  });

  it("es idempotente con la misma clave", async () => {
    const loan = await service.create(workspaceId, userId, input({ ratePercent: 0 }));
    const installment = loan.installments[0]!;
    const key = randomUUID();
    const first = await service.pay(workspaceId, userId, loan.id as string, installment.id as string, { amount: 10000, receivingAccountId: receivingId, idempotencyKey: key });
    const second = await service.pay(workspaceId, userId, loan.id as string, installment.id as string, { amount: 10000, receivingAccountId: receivingId, idempotencyKey: key });
    expect(second.idempotent).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM issued_loan_payments WHERE workspace_id=${workspaceId}::uuid AND idempotency_key=${key}`).toEqual([{ count: 1n }]);
  });

  it("paga por completo, marca PAID y la reversión lo reactiva atómicamente", async () => {
    const loan = await service.create(workspaceId, userId, input({ principal: 50000, ratePercent: 0, termCount: 1 }));
    const installment = loan.installments[0]!;
    const paid = await service.pay(workspaceId, userId, loan.id as string, installment.id as string, { amount: 50000, receivingAccountId: receivingId, idempotencyKey: randomUUID() });
    expect(paid.status).toBe("PAID");
    expect(Number(paid.currentPrincipal)).toBe(0);
    const reversed = await service.reverse(workspaceId, userId, loan.id as string, paid.paymentId!, "Error de digitación");
    expect(reversed.status).toBe("ACTIVE");
    expect(Number(reversed.currentPrincipal)).toBe(50000);
    expect(reversed.installments[0]?.status).toBe("PENDING");
    expect(Number(reversed.installments[0]?.totalPaid)).toBe(0);
    expect((reversed.payments[0] as Record<string, unknown>).reversedAt).not.toBeNull();
  });

  it("bloquea archivo con saldo y permite archivar sólo un préstamo pagado", async () => {
    const active = await service.create(workspaceId, userId, input({ principal: 30000, ratePercent: 0, termCount: 1 }));
    await expect(service.archive(workspaceId, userId, active.id as string)).rejects.toThrow(/saldo/);
    const paid = await service.pay(workspaceId, userId, active.id as string, active.installments[0]!.id as string, { amount: 30000, receivingAccountId: receivingId, idempotencyKey: randomUUID() });
    expect(await service.archive(workspaceId, userId, paid.id as string)).toEqual({ id: paid.id, archived: true });
    expect((await service.list(workspaceId, {})).map((row) => row.id)).not.toContain(paid.id);
    expect((await service.list(workspaceId, { status: "ARCHIVED" })).map((row) => row.id)).toContain(paid.id);
  });
});
