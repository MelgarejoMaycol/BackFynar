import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { Prisma } from "@prisma/client";
import { emailService } from "../../src/modules/auth/email.service.js";
const suffix = randomUUID().replaceAll("-", "");
const actors = ["owner", "other"].map((x) => ({
  email: `phase9-${x}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  token: "",
}));
const auth = (x: string) => ({ Authorization: `Bearer ${x}` }),
  url = (path: string, w = actors[0]!.workspaceId) => `/api/v1/workspaces/${w}${path}`;
let asset = "",
  liability = "",
  card = "",
  category = "",
  debt = "",
  installment = "",
  payment = "",
  obligation = "",
  occurrence = "",
  overdueOccurrence = "",
  partialInstallment = "",
  statement = "";
let cleanDebt = "";
let readRole = "";
const evidence: Record<string, unknown> = {};
describe.sequential("Fase 9 backend de pasivos", () => {
  afterAll(async () => {
    const ws = actors.map((x) => x.workspaceId).filter(Boolean),
      users = actors.map((x) => x.id).filter(Boolean);
    if (ws.length) {
      await prisma.obligationPayment.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.cardStatement.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.cardPurchaseInstallment.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.cardPurchase.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.obligationOccurrence.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.debtPayment.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.debtReconciliation.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.financialEvent.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.auditLog.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ws } } });
    }
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (readRole) await prisma.role.delete({ where: { id: readRole } });
    await prisma.$disconnect();
  });
  it("prepara workspaces, cuentas y categoría", async () => {
    const verificationTokens = new Map<string, string>();
    const emailSpy = vi
      .spyOn(emailService, "sendVerification")
      .mockImplementation(async (message) => {
        verificationTokens.set(
          message.recipient,
          new URL(message.verificationUrl).searchParams.get("token")!,
        );
        return undefined;
      });
    for (const a of actors) {
      const registered = await request(app).post("/api/v1/auth/register").send({
        email: a.email,
        password: "Phase nine secure password 1!",
        firstName: "Phase9",
        acceptedTerms: true,
      });
      expect(registered.status).toBe(201);
      const verified = await request(app)
        .post("/api/v1/auth/verify-email")
        .send({ token: verificationTokens.get(a.email) });
      expect(verified.status).toBe(204);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
      const workspace = await prisma.workspace.findFirstOrThrow({
        where: { ownerUserId: user.id },
      });
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: a.email, password: "Phase nine secure password 1!" });
      expect(login.status).toBe(200);
      a.id = user.id;
      a.workspaceId = workspace.id;
      a.token = login.body.data.tokens.accessToken;
    }
    emailSpy.mockRestore();
    const createAccount = (body: object) =>
      request(app).post(url("/accounts")).set(auth(actors[0]!.token)).send(body);
    const bankResponse = await createAccount({
      name: `Banco ${suffix}`,
      type: "SAVINGS",
      nature: "ASSET",
      currency: "COP",
      openingBalance: "10000000",
    });
    const liabilityResponse = await createAccount({
      name: `Préstamo ${suffix}`,
      type: "LOAN",
      nature: "LIABILITY",
      currency: "COP",
      openingBalance: "1000000",
    });
    const cardResponse = await request(app)
      .post(url("/cards"))
      .set(auth(actors[0]!.token))
      .send({
        name: `Tarjeta ${suffix}`,
        currency: "COP",
        creditLimit: "2000000",
        usedCredit: "0",
        billingDay: 25,
        paymentDueDay: 10,
      });
    expect([bankResponse.status, liabilityResponse.status, cardResponse.status]).toEqual([
      201, 201, 201,
    ]);
    asset = bankResponse.body.data.id;
    liability = liabilityResponse.body.data.id;
    card = cardResponse.body.data.id;
    const persistedAccounts = await request(app).get(url("/accounts")).set(auth(actors[0]!.token));
    expect(persistedAccounts.body.data).toHaveLength(3);
    category = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "EXPENSE" } })
    ).id;
  }, 60000);
  it("crea y lista tarjetas con precisión decimal y valida su contrato", async () => {
    const post = (body: object) =>
      request(app).post(url("/cards")).set(auth(actors[0]!.token)).send(body);
    const sharedName = `Shared account ${suffix}`;
    expect(
      (
        await request(app).post(url("/accounts")).set(auth(actors[0]!.token)).send({
          name: sharedName,
          type: "CASH",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "0",
        })
      ).status,
    ).toBe(201);
    expect(
      (await post({ name: sharedName, currency: "COP", creditLimit: "100.00", usedCredit: "0.00" }))
        .status,
    ).toBe(409);
    const available = await post({
      name: `Card available ${suffix}`,
      institutionName: "Coomuldesa",
      currency: "COP",
      creditLimit: "1500000.00",
      availableCredit: "675231.02",
      billingDay: 20,
      paymentDueDay: 5,
    });
    expect(available.status).toBe(201);
    expect(available.body.data).toMatchObject({
      creditLimit: "1500000.00",
      openingBalance: "824768.98",
      currentBalance: "824768.98",
      billingDay: 20,
      paymentDueDay: 5,
      type: "CREDIT_CARD",
      nature: "LIABILITY",
    });
    const used = await post({
      name: `Card used ${suffix}`,
      currency: "USD",
      creditLimit: "1000.00",
      usedCredit: "125.25",
    });
    expect(used.status).toBe(201);
    expect(used.body.data.currentBalance).toBe("125.25");
    const unused = await post({
      name: `Card unused ${suffix}`,
      currency: "COP",
      creditLimit: "500.00",
      availableCredit: "500.00",
    });
    expect(unused.status).toBe(201);
    expect(unused.body.data.currentBalance).toBe("0.00");
    const paidCycle = await post({
      name: `Card paid cycle ${suffix}`,
      currency: "COP",
      creditLimit: "1000000.00",
      usedCredit: "800000.00",
      billingDay: 25,
      paymentDueDay: 5,
      currentCyclePaid: true,
    });
    expect(paidCycle.status).toBe(201);
    const paidCycleRow = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: paidCycle.body.data.id },
    });
    expect(paidCycleRow.cardCyclePaidThrough).not.toBeNull();
    expect(
      (
        await post({
          name: `Card invalid ${suffix}`,
          currency: "COP",
          creditLimit: "100",
          availableCredit: "101",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          name: `Card day 0 ${suffix}`,
          currency: "COP",
          creditLimit: "100",
          usedCredit: "0",
          billingDay: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          name: `Card day 32 ${suffix}`,
          currency: "COP",
          creditLimit: "100",
          usedCredit: "0",
          paymentDueDay: 32,
        })
      ).status,
    ).toBe(400);
    const duplicate = await post({
      name: `Card available ${suffix}`,
      currency: "COP",
      creditLimit: "100",
      usedCredit: "0",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe("Ya existe una cuenta o tarjeta con ese nombre");
    expect(
      (
        await post({
          name: `  CARD   AVAILABLE ${suffix}  `,
          currency: "COP",
          creditLimit: "100",
          usedCredit: "0",
        })
      ).status,
    ).toBe(409);
    const listed = await request(app).get(url("/cards")).set(auth(actors[0]!.token));
    expect(listed.status).toBe(200);
    expect(
      listed.body.data.find((item: { id: string }) => item.id === available.body.data.id),
    ).toMatchObject({
      creditLimit: "1500000.00",
      usedCredit: "824768.98",
      availableCredit: "675231.02",
      utilization: "54.98",
      billingDay: 20,
      paymentDueDay: 5,
      currency: "COP",
    });
    const listedPaidCycle = listed.body.data.find(
      (item: { id: string }) => item.id === paidCycle.body.data.id,
    );
    expect(new Date(`${listedPaidCycle.nextPaymentDate}T00:00:00Z`).getTime()).toBeGreaterThan(
      paidCycleRow.cardCyclePaidThrough!.getTime(),
    );
  });
  it("crea crédito y cronograma", async () => {
    const estimation = await request(app)
      .post(url("/debts/estimate"))
      .set(auth(actors[0]!.token))
      .send({
        originalPrincipal: "1000000",
        interestRate: "0.01",
        interestRateBasis: "EFFECTIVE_MONTHLY",
        totalInstallments: 12,
      });
    expect(estimation.status).toBe(200);
    expect(estimation.body.data.paymentAmount.source).toBe("CALCULATED");
    expect(Number(estimation.body.data.paymentAmount.value)).toBeGreaterThan(0);
    const r = await request(app).post(url("/debts")).set(auth(actors[0]!.token)).send({
      name: "Crédito integración",
      type: "BANK_LOAN",
      currency: "COP",
      originalAmount: "1000000",
      currentBalance: "1000000",
      interestRate: "0.01",
      interestRateBasis: "EFFECTIVE_MONTHLY",
      interestType: "FIXED",
      termMonths: 12,
      firstPaymentDate: "2026-09-01",
      liabilityAccountId: liability,
    });
    expect(r.status).toBe(201);
    debt = r.body.data.id;
    expect(r.body.data.debtInstallments).toHaveLength(12);
    const rows = await prisma.debtInstallment.findMany({
      where: { debtId: debt },
      orderBy: { installmentNumber: "asc" },
    });
    expect(
      rows.reduce((sum, row) => sum.plus(row.principalAmount), new Prisma.Decimal(0)).eq("1000000"),
    ).toBe(true);
    for (let index = 0; index < rows.length - 1; index += 1)
      expect(rows[index]!.closingBalance.eq(rows[index + 1]!.openingBalance)).toBe(true);
    expect(rows.at(-1)!.closingBalance.isZero()).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.interestAmount.gte(0) &&
          row.principalAmount.gte(0) &&
          row.totalAmount.gte(row.principalAmount),
      ),
    ).toBe(true);
    const zero = await request(app).post(url("/debts")).set(auth(actors[0]!.token)).send({
      name: "Crédito cero",
      type: "PERSONAL_LOAN",
      currency: "COP",
      originalAmount: "1200000",
      interestRate: "0",
      interestRateBasis: "EFFECTIVE_MONTHLY",
      interestType: "NONE",
      termMonths: 12,
      firstPaymentDate: "2028-01-31",
    });
    expect(zero.status).toBe(201);
    cleanDebt = zero.body.data.id;
    expect(zero.body.data.installmentAmount).toBe("100000.00");
    expect(
      zero.body.data.debtInstallments.reduce(
        (sum: number, row: { interestAmount: string }) => sum + Number(row.interestAmount),
        0,
      ),
    ).toBe(0);
    expect(
      zero.body.data.debtInstallments
        .map((row: { dueDate: string }) => row.dueDate.slice(0, 10))
        .slice(0, 4),
    ).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
    installment = r.body.data.debtInstallments[0].id;
    const foreign = await request(app)
      .get(url(`/debts/${debt}`, actors[1]!.workspaceId))
      .set(auth(actors[1]!.token));
    expect(foreign.status).toBe(404);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "debts.read" } });
    const role = await prisma.role.create({
      data: {
        code: `PHASE9_READ_${suffix}`,
        name: "Phase9 read",
        isSystem: false,
        permissions: { create: { permissionId: permission.id } },
      },
    });
    readRole = role.id;
    await prisma.workspaceMember.create({
      data: {
        workspaceId: actors[0]!.workspaceId,
        userId: actors[1]!.id,
        roleId: role.id,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
    expect(
      (
        await request(app)
          .get(url(`/debts/${debt}`))
          .set(auth(actors[1]!.token))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(url("/debts"))
          .set(auth(actors[1]!.token))
          .send({ name: "No autorizado", type: "OTHER", currency: "COP", originalAmount: "100" })
      ).status,
    ).toBe(403);
  });
  it("paga parcial, es idempotente y revierte", async () => {
    const body = {
      accountId: asset,
      amount: "1000",
      paidAt: "2026-09-01T12:00:00Z",
      idempotencyKey: `pay-${suffix}`,
      principalAmount: "800",
      interestAmount: "200",
      insuranceAmount: "0",
      feeAmount: "0",
      extraPaymentAmount: "0",
    };
    const bankBefore = await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } });
    const installmentEvent = await prisma.financialEvent.findFirstOrThrow({
      where: { relatedDebtInstallmentId: installment },
    });
    expect(installmentEvent.isCompleted).toBe(false);
    expect(installmentEvent.amount?.gt(0)).toBe(true);
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(url(`/debts/${debt}/installments/${installment}/payments`))
          .set(auth(actors[0]!.token))
          .send(body),
      ),
    );
    const first = responses[0]!;
    const duplicate = responses[1]!;
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(201);
    payment = first.body.data.id;
    expect([first.body.data.idempotent, duplicate.body.data.idempotent]).toContain(true);
    expect(
      await prisma.debtPayment.count({
        where: { workspaceId: actors[0]!.workspaceId, idempotencyKey: body.idempotencyKey },
      }),
    ).toBe(1);
    const bankAfter = await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } });
    expect(bankBefore.currentBalance.minus(bankAfter.currentBalance).eq("1000")).toBe(true);
    expect(
      await prisma.transaction.count({
        where: { workspaceId: actors[0]!.workspaceId, externalReference: body.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedDebtInstallmentId: installment },
      }),
    ).toMatchObject({ isCompleted: false });
    const invalidBefore = await prisma.debtPayment.count({ where: { debtId: debt } });
    const invalid = await request(app)
      .post(url(`/debts/${debt}/installments/${installment}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        ...body,
        idempotencyKey: `rollback-${suffix}`,
        amount: "500",
        principalAmount: "100",
      });
    expect(invalid.status).toBe(409);
    expect(await prisma.debtPayment.count({ where: { debtId: debt } })).toBe(invalidBefore);
    const reverse = await request(app)
      .post(url(`/debts/${debt}/payments/${payment}/reverse`))
      .set(auth(actors[0]!.token))
      .send({ reason: "Prueba de reversión" });
    expect(reverse.status).toBe(200);
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedDebtInstallmentId: installment },
      }),
    ).toMatchObject({ isCompleted: false });
    const twice = await request(app)
      .post(url(`/debts/${debt}/payments/${payment}/reverse`))
      .set(auth(actors[0]!.token))
      .send({ reason: "Otra vez" });
    expect(twice.status).toBe(409);
    const nextInstallment = await prisma.debtInstallment.findFirstOrThrow({
      where: { debtId: debt, id: { not: installment } },
      orderBy: { installmentNumber: "asc" },
    });
    partialInstallment = nextInstallment.id;
    const partial = await request(app)
      .post(url(`/debts/${debt}/installments/${partialInstallment}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "100",
        paidAt: "2026-09-12T12:00:00Z",
        idempotencyKey: `credit-partial-${suffix}`,
      });
    expect(partial.status).toBe(201);
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedDebtInstallmentId: partialInstallment },
      }),
    ).toMatchObject({
      isCompleted: false,
      amount: nextInstallment.totalAmount.minus("100"),
    });
    const accountBeforeExternal = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: asset },
    });
    const externalKey = `credit-external-${suffix}`;
    const externalPayment = await request(app)
      .post(url(`/debts/${debt}/installments/${partialInstallment}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        amount: "50",
        paidAt: "2026-09-13T12:00:00Z",
        idempotencyKey: externalKey,
      });
    expect(externalPayment.status).toBe(201);
    const externalTransaction = await prisma.transaction.findFirstOrThrow({
      where: { workspaceId: actors[0]!.workspaceId, externalReference: externalKey },
    });
    expect(externalTransaction.accountId).toBeNull();
    expect(externalTransaction.metadata).toMatchObject({ paymentSource: "EXTERNAL" });
    expect(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } })).currentBalance.eq(
        accountBeforeExternal.currentBalance,
      ),
    ).toBe(true);
    const externalRetry = await request(app)
      .post(url(`/debts/${debt}/installments/${partialInstallment}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        amount: "50",
        paidAt: "2026-09-13T12:00:00Z",
        idempotencyKey: externalKey,
      });
    expect(externalRetry.body.data.idempotent).toBe(true);
    expect(
      await prisma.debtPayment.count({
        where: { workspaceId: actors[0]!.workspaceId, idempotencyKey: externalKey },
      }),
    ).toBe(1);
    evidence.credit = {
      bankBefore: bankBefore.currentBalance.toFixed(2),
      payment: "1000.00",
      principal: "800.00",
      interest: "200.00",
      bankAfter: bankAfter.currentBalance.toFixed(2),
      reversed: true,
    };
  });
  it("simula y aplica ambas modalidades de abono, luego concilia", async () => {
    const before = await prisma.debt.findUniqueOrThrow({ where: { id: cleanDebt } });
    const reducePaymentSimulation = await request(app)
      .post(url(`/debts/${cleanDebt}/prepayments/simulate`))
      .set(auth(actors[0]!.token))
      .send({ amount: "100000", strategy: "REDUCE_PAYMENT" });
    expect(reducePaymentSimulation.status).toBe(200);
    expect(
      new Prisma.Decimal(reducePaymentSimulation.body.data.paymentAfter).lt(
        reducePaymentSimulation.body.data.paymentBefore,
      ),
    ).toBe(true);
    const appliedPayment = await request(app)
      .post(url(`/debts/${cleanDebt}/prepayments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "100000",
        strategy: "REDUCE_PAYMENT",
        occurredAt: "2026-09-02T12:00:00Z",
        idempotencyKey: `prepay-payment-${suffix}`,
      });
    expect(appliedPayment.status).toBe(201);
    const middle = await prisma.debt.findUniqueOrThrow({ where: { id: cleanDebt } });
    expect(middle.currentBalance.eq(before.currentBalance.minus("100000"))).toBe(true);
    expect(middle.installmentAmount!.lt(before.installmentAmount!)).toBe(true);
    const reduceTermSimulation = await request(app)
      .post(url(`/debts/${cleanDebt}/prepayments/simulate`))
      .set(auth(actors[0]!.token))
      .send({ amount: "100000", strategy: "REDUCE_TERM" });
    expect(reduceTermSimulation.status).toBe(200);
    expect(reduceTermSimulation.body.data.installmentsAfter).toBeLessThanOrEqual(
      reduceTermSimulation.body.data.installmentsBefore,
    );
    const appliedTerm = await request(app)
      .post(url(`/debts/${cleanDebt}/prepayments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "100000",
        strategy: "REDUCE_TERM",
        occurredAt: "2026-09-03T12:00:00Z",
        idempotencyKey: `prepay-term-${suffix}`,
      });
    expect(appliedTerm.status).toBe(201);
    const after = await prisma.debt.findUniqueOrThrow({ where: { id: cleanDebt } });
    expect(after.currentBalance.eq(middle.currentBalance.minus("100000"))).toBe(true);
    const reported = after.currentBalance.minus("5000");
    const reconciled = await request(app)
      .post(url(`/debts/${cleanDebt}/reconciliations`))
      .set(auth(actors[0]!.token))
      .send({
        reportedBalance: reported.toFixed(2),
        effectiveDate: "2026-09-04",
        source: "Banco prueba",
      });
    expect(reconciled.status).toBe(201);
    const reconciliation = await prisma.debtReconciliation.findUniqueOrThrow({
      where: { id: reconciled.body.data.id },
    });
    expect(reconciliation.calculatedBalance.eq(after.currentBalance)).toBe(true);
    expect(reconciliation.reportedBalance.eq(reported)).toBe(true);
    const projected = await prisma.debtInstallment.findFirstOrThrow({
      where: { debtId: cleanDebt, status: "PENDING" },
      orderBy: { installmentNumber: "asc" },
    });
    expect(projected.openingBalance.eq(reported)).toBe(true);
    evidence.prepayment = {
      paymentBefore: reducePaymentSimulation.body.data.paymentBefore,
      paymentAfter: reducePaymentSimulation.body.data.paymentAfter,
      installmentsBefore: reduceTermSimulation.body.data.installmentsBefore,
      installmentsAfter: reduceTermSimulation.body.data.installmentsAfter,
      balanceBefore: before.currentBalance.toFixed(2),
      balanceAfter: reported.toFixed(2),
    };
  });
  it("crea obligación, ocurrencia y pago", async () => {
    const o = await request(app).post(url("/obligations")).set(auth(actors[0]!.token)).send({
      name: "Internet",
      expectedAmount: "80000",
      currency: "COP",
      amountType: "FIXED",
      frequency: "MONTHLY",
      startsOn: "2026-08-15",
      paymentAccountId: asset,
      categoryId: category,
    });
    expect(o.status).toBe(201);
    obligation = o.body.data.id;
    const oc = await request(app)
      .post(url(`/obligations/${obligation}/occurrences`))
      .set(auth(actors[0]!.token))
      .send({ dueDate: "2026-08-15" });
    expect(oc.status).toBe(201);
    occurrence = oc.body.data.id;
    const partial = await request(app)
      .post(url(`/obligations/${obligation}/occurrences/${occurrence}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "30000",
        occurredAt: "2026-08-15T12:00:00Z",
        idempotencyKey: `obl-partial-${suffix}`,
      });
    expect(partial.status).toBe(201);
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedObligationOccurrenceId: occurrence },
      }),
    ).toMatchObject({ isCompleted: false, amount: new Prisma.Decimal("50000") });
    const paid = await request(app)
      .post(url(`/obligations/${obligation}/occurrences/${occurrence}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "50000",
        occurredAt: "2026-08-15T13:00:00Z",
        idempotencyKey: `obl-final-${suffix}`,
      });
    expect(paid.status).toBe(201);
    const persistedOccurrence = await prisma.obligationOccurrence.findUniqueOrThrow({
      where: { id: occurrence },
    });
    expect(persistedOccurrence.status).toBe("PAID");
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedObligationOccurrenceId: occurrence },
      }),
    ).toMatchObject({ isCompleted: true, amount: new Prisma.Decimal("0") });
    const nextOccurrence = await prisma.obligationOccurrence.findFirstOrThrow({
      where: {
        workspaceId: actors[0]!.workspaceId,
        obligationId: obligation,
        dueDate: new Date("2026-09-15T00:00:00Z"),
      },
    });
    expect(nextOccurrence).toMatchObject({
      status: "PENDING",
      amount: new Prisma.Decimal("80000"),
    });
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedObligationOccurrenceId: nextOccurrence.id },
      }),
    ).toMatchObject({ isCompleted: false, amount: new Prisma.Decimal("80000") });
    evidence.obligation = {
      amount: persistedOccurrence.amount.toFixed(2),
      paid: persistedOccurrence.paidAmount.toFixed(2),
      status: persistedOccurrence.status,
    };
    const variable = await request(app).post(url("/obligations")).set(auth(actors[0]!.token)).send({
      name: "Energía",
      expectedAmount: "120000",
      currency: "COP",
      amountType: "VARIABLE",
      frequency: "MONTHLY",
      startsOn: "2026-08-20",
      paymentAccountId: asset,
      categoryId: category,
    });
    expect(variable.status).toBe(201);
    const august = await request(app)
      .post(url(`/obligations/${variable.body.data.id}/occurrences`))
      .set(auth(actors[0]!.token))
      .send({ dueDate: "2026-08-20", amount: "118400" });
    const september = await request(app)
      .post(url(`/obligations/${variable.body.data.id}/occurrences`))
      .set(auth(actors[0]!.token))
      .send({ dueDate: "2026-09-20", amount: "132700" });
    expect(august.status).toBe(201);
    expect(september.status).toBe(201);
    await request(app)
      .post(url(`/obligations/${variable.body.data.id}/occurrences`))
      .set(auth(actors[0]!.token))
      .send({ dueDate: "2026-09-20", amount: "130000" });
    expect(
      (
        await prisma.obligationOccurrence.findUniqueOrThrow({ where: { id: august.body.data.id } })
      ).amount.eq("118400"),
    ).toBe(true);
    expect(
      (
        await prisma.obligationOccurrence.findUniqueOrThrow({
          where: { id: september.body.data.id },
        })
      ).amount.eq("130000"),
    ).toBe(true);
    expect(
      await prisma.financialEvent.findFirstOrThrow({
        where: { relatedObligationOccurrenceId: september.body.data.id },
      }),
    ).toMatchObject({ isCompleted: false, amount: new Prisma.Decimal("130000") });
    const overdue = await request(app)
      .post(url(`/obligations/${variable.body.data.id}/occurrences`))
      .set(auth(actors[0]!.token))
      .send({ dueDate: "2026-08-01", amount: "50000" });
    expect(overdue.status).toBe(201);
    overdueOccurrence = overdue.body.data.id;
  });
  it("corrige cuenta y monto, protege el movimiento y revierte el pago de obligación", async () => {
    const destination = await request(app)
      .post(url("/accounts"))
      .set(auth(actors[0]!.token))
      .send({
        name: `Nequi integridad ${suffix}`,
        type: "E_WALLET",
        nature: "ASSET",
        currency: "COP",
        openingBalance: "500000",
      });
    expect(destination.status).toBe(201);
    const activePayments = await prisma.obligationPayment.findMany({
      where: { occurrenceId: occurrence, reversedAt: null },
      orderBy: { paidAt: "asc" },
    });
    expect(activePayments).toHaveLength(2);
    const target = activePayments[1]!;
    const sourceBefore = await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } });

    const corrected = await request(app)
      .patch(url(`/obligations/${obligation}/payments/${target.id}`))
      .set(auth(actors[0]!.token))
      .send({ accountId: destination.body.data.id, amount: "40000", version: 1 });
    expect(corrected.status).toBe(200);
    expect(await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } })).toMatchObject(
      {
        currentBalance: sourceBefore.currentBalance.plus("50000"),
      },
    );
    expect(
      await prisma.financialAccount.findUniqueOrThrow({ where: { id: destination.body.data.id } }),
    ).toMatchObject({ currentBalance: new Prisma.Decimal("460000") });
    expect(
      await prisma.obligationOccurrence.findUniqueOrThrow({ where: { id: occurrence } }),
    ).toMatchObject({
      paidAmount: new Prisma.Decimal("70000"),
      status: "PARTIAL",
    });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: target.transactionId } }),
    ).toMatchObject({
      accountId: destination.body.data.id,
      amount: new Prisma.Decimal("40000"),
      status: "CONFIRMED",
    });

    const protectedDelete = await request(app)
      .delete(url(`/transactions/${target.transactionId}`))
      .set(auth(actors[0]!.token))
      .send({ version: 2 });
    expect(protectedDelete.status).toBe(409);
    expect(await prisma.obligationPayment.count({ where: { occurrenceId: occurrence } })).toBe(2);

    const reversed = await request(app)
      .post(url(`/obligations/${obligation}/payments/${target.id}/reverse`))
      .set(auth(actors[0]!.token))
      .send({ reason: "Corrección de prueba integral", version: 2 });
    expect(reversed.status).toBe(200);
    expect(
      await prisma.financialAccount.findUniqueOrThrow({ where: { id: destination.body.data.id } }),
    ).toMatchObject({ currentBalance: new Prisma.Decimal("500000") });
    expect(
      await prisma.obligationOccurrence.findUniqueOrThrow({ where: { id: occurrence } }),
    ).toMatchObject({
      paidAmount: new Prisma.Decimal("30000"),
      status: "PARTIAL",
    });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: target.transactionId } }),
    ).toMatchObject({
      status: "CANCELLED",
    });
    expect(
      await prisma.obligationPayment.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({
      reversedAt: expect.any(Date),
      reversalReason: "Corrección de prueba integral",
    });
    const repaid = await request(app)
      .post(url(`/obligations/${obligation}/occurrences/${occurrence}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "50000",
        occurredAt: "2026-08-15T14:00:00Z",
        idempotencyKey: `obl-repaid-${suffix}`,
      });
    expect(repaid.status).toBe(201);
  });
  it("integra movimientos genéricos con compras, estimaciones y pagos sin extracto", async () => {
    const createExpense = (amount: string, note: string) =>
      request(app)
        .post(url("/transactions/expense"))
        .set(auth(actors[0]!.token))
        .send({
          accountId: card,
          categoryId: category,
          amount,
          occurredAt: "2026-08-14T12:00:00Z",
          description: "Compra desde Movimientos",
          cardPurchase: { installmentCount: 2, periodicRate: "1.5", firstDueDate: "2026-09-10" },
          notes: note,
        });
    const created = await createExpense("100000", "generic-create");
    expect(created.status).toBe(201);
    const transactionId = created.body.data.id as string;
    expect(await prisma.cardPurchase.count({ where: { transactionId } })).toBe(1);
    expect(
      await prisma.cardPurchaseInstallment.count({ where: { purchase: { transactionId } } }),
    ).toBe(2);
    expect(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } })).currentBalance.eq(
        "100000",
      ),
    ).toBe(true);

    const updated = await request(app)
      .patch(url(`/transactions/${transactionId}`))
      .set(auth(actors[0]!.token))
      .send({
        version: created.body.data.version,
        amount: "125000",
        cardPurchase: { installmentCount: 3, firstDueDate: "2026-09-10" },
      });
    expect(updated.status).toBe(200);
    expect(await prisma.cardPurchase.count({ where: { transactionId } })).toBe(1);
    expect(
      await prisma.cardPurchaseInstallment.count({ where: { purchase: { transactionId } } }),
    ).toBe(3);
    expect(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } })).currentBalance.eq(
        "125000",
      ),
    ).toBe(true);

    const cancelled = await request(app)
      .delete(url(`/transactions/${transactionId}`))
      .set(auth(actors[0]!.token))
      .send({ version: updated.body.data.version });
    expect(cancelled.status).toBe(200);
    expect(await prisma.cardPurchase.count({ where: { transactionId } })).toBe(0);
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } })
      ).currentBalance.isZero(),
    ).toBe(true);

    const purchaseCountBeforeRejection = await prisma.transaction.count({
      where: { workspaceId: actors[0]!.workspaceId },
    });
    const rejected = await createExpense("2500000", "generic-over-limit");
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.message).toContain("No tienes cupo suficiente");
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } })
      ).currentBalance.isZero(),
    ).toBe(true);
    expect(await prisma.transaction.count({ where: { workspaceId: actors[0]!.workspaceId } })).toBe(
      purchaseCountBeforeRejection,
    );

    const payable = await createExpense("80000", "generic-payable");
    expect(payable.status).toBe(201);
    const upcoming = await request(app).get(url("/upcoming-payments")).set(auth(actors[0]!.token));
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: card,
          type: "CARD_ESTIMATE",
          amount: "80000.00",
          source: "ESTIMATED",
        }),
      ]),
    );

    const sourceBefore = await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } });
    const paid = await request(app)
      .post(url(`/cards/${card}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        sourceAccountId: asset,
        amount: "80000",
        occurredAt: "2026-08-15T12:00:00Z",
        idempotencyKey: `card-direct-payment-${suffix}`,
      });
    expect(paid.status).toBe(201);
    const paymentTransaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: paid.body.data.transactionId },
    });
    expect(paymentTransaction.type).toBe("TRANSFER");
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: card } })
      ).currentBalance.isZero(),
    ).toBe(true);
    const sourceAfter = await prisma.financialAccount.findUniqueOrThrow({ where: { id: asset } });
    expect(sourceBefore.currentBalance.minus(sourceAfter.currentBalance).eq("80000")).toBe(true);
    const afterPayment = await request(app)
      .get(url("/upcoming-payments"))
      .set(auth(actors[0]!.token));
    expect(afterPayment.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceId: card, type: "CARD_ESTIMATE" }),
      ]),
    );
  });
  it("registra compra, extracto y pago de tarjeta sin segundo gasto", async () => {
    const purchase = await request(app)
      .post(url(`/cards/${card}/purchases`))
      .set(auth(actors[0]!.token))
      .send({
        amount: "120000",
        categoryId: category,
        occurredAt: "2026-08-12T12:00:00Z",
        description: "Compra tarjeta",
        installmentCount: 3,
        periodicRate: "0",
        firstDueDate: "2026-09-10",
        idempotencyKey: `card-buy-${suffix}`,
      });
    expect(purchase.status).toBe(201);
    const cardAfterPurchase = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: card },
    });
    expect(cardAfterPurchase.currentBalance.eq("120000")).toBe(true);
    expect(
      await prisma.cardPurchaseInstallment.count({
        where: { cardPurchaseId: purchase.body.data.purchaseId },
      }),
    ).toBe(3);
    const purchases = await request(app)
      .get(url(`/cards/${card}/purchases`))
      .set(auth(actors[0]!.token));
    expect(purchases.status).toBe(200);
    const listedPurchase = purchases.body.data.find(
      (item: { id: string }) => item.id === purchase.body.data.purchaseId,
    );
    expect(listedPurchase.transaction.description).toBe("Compra tarjeta");
    expect(listedPurchase.installments).toHaveLength(3);
    expect(listedPurchase.trackingStatus).toBe("ESTIMATED");
    expect(listedPurchase.installments[0].trackingStatus).toBe("ESTIMATED");
    const st = await request(app)
      .post(url(`/cards/${card}/statements`))
      .set(auth(actors[0]!.token))
      .send({
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        dueDate: "2026-09-10",
        previousBalance: "0",
        interestAmount: "0",
        feeAmount: "0",
        minimumPayment: "30000",
      });
    expect(st.status).toBe(201);
    statement = st.body.data.id;
    const before = await prisma.transaction.count({
      where: { workspaceId: actors[0]!.workspaceId, type: "EXPENSE" },
    });
    const paid = await request(app)
      .post(url(`/cards/${card}/statements/${statement}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        sourceAccountId: asset,
        amount: "30000",
        occurredAt: "2026-09-01T12:00:00Z",
        idempotencyKey: `card-pay-${suffix}`,
      });
    expect(paid.status).toBe(201);
    expect(
      await prisma.transaction.count({
        where: { workspaceId: actors[0]!.workspaceId, type: "EXPENSE" },
      }),
    ).toBe(before);
    expect(
      await prisma.transaction.count({
        where: { id: paid.body.data.transactionId, type: "TRANSFER" },
      }),
    ).toBe(1);
    const partialStatementEvent = await prisma.financialEvent.findFirstOrThrow({
      where: { relatedCardStatementId: statement },
    });
    expect(partialStatementEvent.isCompleted).toBe(false);
    expect(partialStatementEvent.amount?.eq("90000")).toBe(true);
    const fullyPaid = await request(app)
      .post(url(`/cards/${card}/statements/${statement}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        sourceAccountId: asset,
        amount: "90000",
        occurredAt: "2026-09-02T12:00:00Z",
        idempotencyKey: `card-pay-final-${suffix}`,
      });
    expect(fullyPaid.status).toBe(201);
    const paidStatementEvent = await prisma.financialEvent.findFirstOrThrow({
      where: { relatedCardStatementId: statement },
    });
    expect(paidStatementEvent.isCompleted).toBe(true);
    expect(paidStatementEvent.amount?.isZero()).toBe(true);
    const overdueCard = await request(app)
      .post(url(`/cards/${card}/statements`))
      .set(auth(actors[0]!.token))
      .send({
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        dueDate: "2026-08-10",
        previousBalance: "5000",
        interestAmount: "0",
        feeAmount: "0",
        minimumPayment: "1000",
      });
    expect(overdueCard.status).toBe(201);
    const rejectedBefore = await prisma.transaction.count({
      where: { workspaceId: actors[0]!.workspaceId },
    });
    const rejected = await request(app)
      .post(url(`/cards/${card}/purchases`))
      .set(auth(actors[0]!.token))
      .send({
        amount: "3000000",
        categoryId: category,
        occurredAt: "2026-08-13T12:00:00Z",
        description: "Sin cupo",
        firstDueDate: "2026-09-10",
        idempotencyKey: `over-limit-${suffix}`,
      });
    expect(rejected.status).toBe(409);
    expect(await prisma.transaction.count({ where: { workspaceId: actors[0]!.workspaceId } })).toBe(
      rejectedBefore,
    );
    const cardAfterPayment = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: card },
    });
    expect(cardAfterPayment.currentBalance.eq("0")).toBe(true);
    evidence.card = {
      limit: "2000000.00",
      purchase: "120000.00",
      usedAfterPurchase: cardAfterPurchase.currentBalance.toFixed(2),
      payment: "30000.00",
      usedAfterPayment: cardAfterPayment.currentBalance.toFixed(2),
      available: new Prisma.Decimal("2000000").minus(cardAfterPayment.currentBalance).toFixed(2),
    };
  });
  it("lista próximos pagos y resumen", async () => {
    const upcoming = await request(app).get(url("/upcoming-payments")).set(auth(actors[0]!.token));
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.data.length).toBeGreaterThan(0);
    expect(
      upcoming.body.data.every(
        (row: { resourceId?: string }) => typeof row.resourceId === "string",
      ),
    ).toBe(true);
    expect([...upcoming.body.data].map((x: { date: string }) => x.date)).toEqual(
      [...upcoming.body.data].map((x: { date: string }) => x.date).sort(),
    );
    expect(upcoming.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: installment, type: "DEBT_INSTALLMENT" }),
        expect.objectContaining({ id: overdueOccurrence, type: "OBLIGATION", status: "OVERDUE" }),
      ]),
    );
    const activeCardPayments = upcoming.body.data.filter(
      (item: { resourceId: string; type: string }) =>
        item.resourceId === card &&
        ["CARD_STATEMENT", "CARD_EXPECTATION", "CARD_ESTIMATE"].includes(item.type),
    );
    expect(activeCardPayments.length).toBeLessThanOrEqual(1);
    expect(upcoming.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: occurrence }),
        expect.objectContaining({ id: statement }),
      ]),
    );
    const summary = await request(app).get(url("/debts-summary")).set(auth(actors[0]!.token));
    expect(summary.status).toBe(200);
    expect(summary.body.data.activeDebts).toBe(2);
    const report = await request(app)
      .get(
        `${url("/reports/income-vs-expenses")}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31&currency=COP`,
      )
      .set(auth(actors[0]!.token));
    expect(report.status).toBe(200);
    expect(report.body.data.summariesByCurrency[0].totalExpenses).toBe("280000.00");
    const dashboard = await request(app)
      .get(`${url("/dashboard")}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31`)
      .set(auth(actors[0]!.token));
    expect(dashboard.status).toBe(200);
    console.log(`PHASE9_EVIDENCE=${JSON.stringify(evidence)}`);
  });
  it("archiva deuda y obligación sin dejar vencimientos abiertos", async () => {
    const debtRows = await prisma.debtInstallment.findMany({
      where: { debtId: debt },
      orderBy: { installmentNumber: "asc" },
      take: 3,
    });
    await prisma.debtInstallment.update({
      where: { id: debtRows[0]!.id },
      data: { status: "PENDING", paidAmount: 0 },
    });
    await prisma.debtInstallment.update({
      where: { id: debtRows[1]!.id },
      data: { status: "PARTIAL", paidAmount: "100" },
    });
    await prisma.debtInstallment.update({
      where: { id: debtRows[2]!.id },
      data: { status: "OVERDUE", paidAmount: 0 },
    });
    const archivedDebt = await request(app)
      .delete(url(`/debts/${debt}`))
      .set(auth(actors[0]!.token));
    expect(archivedDebt.status).toBe(200);
    expect(
      await prisma.debtInstallment.count({ where: { debtId: debt, status: "CANCELLED" } }),
    ).toBe(12);
    expect(
      await prisma.financialEvent.count({ where: { relatedDebtId: debt, isCompleted: false } }),
    ).toBe(0);

    const created = await request(app).post(url("/obligations")).set(auth(actors[0]!.token)).send({
      name: "Archivo obligación",
      expectedAmount: "1000",
      currency: "COP",
      amountType: "FIXED",
      frequency: "MONTHLY",
      startsOn: "2026-05-01",
      paymentAccountId: asset,
      categoryId: category,
    });
    const archivedObligationId = created.body.data.id as string;
    const occurrenceIds: string[] = [];
    for (const dueDate of ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]) {
      const item = await request(app)
        .post(url(`/obligations/${archivedObligationId}/occurrences`))
        .set(auth(actors[0]!.token))
        .send({ dueDate });
      occurrenceIds.push(item.body.data.id);
    }
    await request(app)
      .post(url(`/obligations/${archivedObligationId}/occurrences/${occurrenceIds[1]}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "400",
        occurredAt: "2026-06-01T12:00:00Z",
        idempotencyKey: `archive-obligation-partial-${suffix}`,
      });
    await request(app)
      .post(url(`/obligations/${archivedObligationId}/occurrences/${occurrenceIds[3]}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "1000",
        occurredAt: "2026-08-01T12:00:00Z",
        idempotencyKey: `archive-obligation-paid-${suffix}`,
      });
    await prisma.obligationOccurrence.update({
      where: { id: occurrenceIds[2]! },
      data: { status: "OVERDUE" },
    });
    const archivedObligation = await request(app)
      .delete(url(`/obligations/${archivedObligationId}`))
      .set(auth(actors[0]!.token));
    expect(archivedObligation.status).toBe(200);
    expect(
      await prisma.obligationOccurrence.count({
        where: { id: { in: occurrenceIds.slice(0, 3) }, status: "CANCELLED" },
      }),
    ).toBe(3);
    expect(
      await prisma.obligationOccurrence.findUniqueOrThrow({ where: { id: occurrenceIds[3]! } }),
    ).toMatchObject({ status: "PAID" });
    expect(
      await prisma.financialEvent.count({
        where: { relatedObligationId: archivedObligationId, isCompleted: false },
      }),
    ).toBe(0);
    const activeObligations = await request(app)
      .get(url("/obligations"))
      .set(auth(actors[0]!.token));
    const archivedObligations = await request(app)
      .get(url("/obligations?archived=true"))
      .set(auth(actors[0]!.token));
    expect(activeObligations.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: archivedObligationId })]),
    );
    expect(archivedObligations.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: archivedObligationId })]),
    );

    const stateBeforeRejectedPayment = {
      transactions: await prisma.transaction.count({
        where: { metadata: { path: ["obligationOccurrenceId"], equals: occurrenceIds[2]! } },
      }),
      occurrences: await prisma.obligationOccurrence.count({
        where: { obligationId: archivedObligationId },
      }),
      events: await prisma.financialEvent.count({
        where: { relatedObligationId: archivedObligationId },
      }),
    };
    const rejectedArchivedPayment = await request(app)
      .post(url(`/obligations/${archivedObligationId}/occurrences/${occurrenceIds[2]}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "100",
        occurredAt: "2026-08-28T12:00:00Z",
        idempotencyKey: `archived-obligation-rejected-${suffix}`,
      });
    expect(rejectedArchivedPayment.status).toBe(409);
    expect(rejectedArchivedPayment.body.error.message).toBe(
      "Esta obligación está archivada. Restáurala antes de registrar nuevos pagos.",
    );
    expect({
      transactions: await prisma.transaction.count({
        where: { metadata: { path: ["obligationOccurrenceId"], equals: occurrenceIds[2]! } },
      }),
      occurrences: await prisma.obligationOccurrence.count({
        where: { obligationId: archivedObligationId },
      }),
      events: await prisma.financialEvent.count({
        where: { relatedObligationId: archivedObligationId },
      }),
    }).toEqual(stateBeforeRejectedPayment);

    const restoredObligation = await request(app)
      .post(url(`/obligations/${archivedObligationId}/restore`))
      .set(auth(actors[0]!.token));
    expect(restoredObligation.status).toBe(200);
    expect(restoredObligation.body.data).toMatchObject({
      id: archivedObligationId,
      status: "ACTIVE",
      deletedAt: null,
    });
    expect(
      await prisma.obligationOccurrence.count({
        where: { obligationId: archivedObligationId },
      }),
    ).toBe(stateBeforeRejectedPayment.occurrences);
    expect(
      await prisma.financialEvent.count({
        where: { relatedObligationId: archivedObligationId },
      }),
    ).toBe(stateBeforeRejectedPayment.events);
    expect(
      await prisma.obligationOccurrence.count({
        where: {
          obligationId: archivedObligationId,
          dueDate: { gte: new Date("2026-08-28T00:00:00Z") },
          status: { in: ["PENDING", "PARTIAL"] },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.obligationOccurrence.findUniqueOrThrow({ where: { id: occurrenceIds[1]! } }),
    ).toMatchObject({ paidAmount: new Prisma.Decimal("400"), status: "CANCELLED" });
  });
});
