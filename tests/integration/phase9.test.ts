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
  statement = "";
let cleanDebt = "";
let readRole = "";
const evidence: Record<string, unknown> = {};
describe.sequential("Fase 9 backend de pasivos", () => {
  afterAll(async () => {
    const ws = actors.map((x) => x.workspaceId).filter(Boolean),
      users = actors.map((x) => x.id).filter(Boolean);
    if (ws.length) {
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
    const cardResponse = await createAccount({
      name: `Tarjeta ${suffix}`,
      type: "CREDIT_CARD",
      nature: "LIABILITY",
      currency: "COP",
      openingBalance: "0",
      creditLimit: "2000000",
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
    const twice = await request(app)
      .post(url(`/debts/${debt}/payments/${payment}/reverse`))
      .set(auth(actors[0]!.token))
      .send({ reason: "Otra vez" });
    expect(twice.status).toBe(409);
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
    const paid = await request(app)
      .post(url(`/obligations/${obligation}/occurrences/${occurrence}/payments`))
      .set(auth(actors[0]!.token))
      .send({
        accountId: asset,
        amount: "80000",
        occurredAt: "2026-08-15T12:00:00Z",
        idempotencyKey: `obl-${suffix}`,
      });
    expect(paid.status).toBe(201);
    const persistedOccurrence = await prisma.obligationOccurrence.findUniqueOrThrow({
      where: { id: occurrence },
    });
    expect(persistedOccurrence.status).toBe("PAID");
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
    expect(purchases.body.data[0].transaction.description).toBe("Compra tarjeta");
    expect(purchases.body.data[0].installments).toHaveLength(3);
    const st = await request(app)
      .post(url(`/cards/${card}/statements`))
      .set(auth(actors[0]!.token))
      .send({
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        dueDate: "2026-09-10",
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
    expect(cardAfterPayment.currentBalance.eq("90000")).toBe(true);
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
    const summary = await request(app).get(url("/debts-summary")).set(auth(actors[0]!.token));
    expect(summary.status).toBe(200);
    expect(summary.body.data.activeDebts).toBe(2);
    const report = await request(app)
      .get(
        `${url("/reports/income-vs-expenses")}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31&currency=COP`,
      )
      .set(auth(actors[0]!.token));
    expect(report.status).toBe(200);
    expect(report.body.data.summariesByCurrency[0].totalExpenses).toBe("200000.00");
    const dashboard = await request(app)
      .get(`${url("/dashboard")}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31`)
      .set(auth(actors[0]!.token));
    expect(dashboard.status).toBe(200);
    console.log(`PHASE9_EVIDENCE=${JSON.stringify(evidence)}`);
  });
});
