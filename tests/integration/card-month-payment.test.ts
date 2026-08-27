import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { emailService } from "../../src/modules/auth/email.service.js";

describe.sequential("pago mensual informado de tarjeta", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `qa-card-month-${suffix}@example.com`;
  let userId = "";
  let workspaceId = "";

  afterAll(async () => {
    if (workspaceId) {
      await prisma.transaction.deleteMany({ where: { workspaceId } });
      await prisma.financialEvent.deleteMany({ where: { workspaceId } });
      await prisma.cardPaymentExpectation.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("distribuye pago mensual y excedente en una sola transferencia idempotente", async () => {
    let verificationToken = "";
    const emailSpy = vi.spyOn(emailService, "sendVerification").mockImplementation(async (input) => {
      verificationToken = new URL(input.verificationUrl).searchParams.get("token") ?? "";
    });
    const password = "QA card month secure password 1!";
    expect(
      (
        await request(app).post("/api/v1/auth/register").send({
          email,
          password,
          firstName: "QA",
          acceptedTerms: true,
        })
      ).status,
    ).toBe(201);
    expect(
      (await request(app).post("/api/v1/auth/verify-email").send({ token: verificationToken }))
        .status,
    ).toBe(204);
    emailSpy.mockRestore();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { ownerUserId: user.id } });
    userId = user.id;
    workspaceId = workspace.id;
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    const authorization = { Authorization: `Bearer ${login.body.data.tokens.accessToken}` };
    const base = `/api/v1/workspaces/${workspaceId}`;

    const bank = await request(app).post(`${base}/accounts`).set(authorization).send({
      name: "QA Nequi",
      type: "E_WALLET",
      nature: "ASSET",
      currency: "COP",
      openingBalance: "2000000.00",
    });
    const card = await request(app).post(`${base}/cards`).set(authorization).send({
      name: "QA Tarjeta",
      currency: "COP",
      creditLimit: "1500000.00",
      usedCredit: "608543.22",
    });
    expect([bank.status, card.status]).toEqual([201, 201]);

    const dueDate = "2026-09-10";
    expect(
      (
        await request(app)
          .post(`${base}/cards/${card.body.data.id}/next-payment`)
          .set(authorization)
          .send({ amount: "56000.00", dueDate })
      ).status,
    ).toBe(201);

    const pay = (amount: string, key: string) =>
      request(app)
        .post(`${base}/cards/${card.body.data.id}/payments`)
        .set(authorization)
        .send({
          sourceAccountId: bank.body.data.id,
          amount,
          occurredAt: "2026-08-18T15:00:00Z",
          idempotencyKey: key,
          applyToNextPayment: true,
        });
    expect((await pay("20000.00", `qa-partial-${suffix}`)).status).toBe(201);
    let expectation = await prisma.cardPaymentExpectation.findFirstOrThrow({
      where: { workspaceId, cardAccountId: card.body.data.id },
    });
    expect(expectation.status).toBe("PARTIAL");
    expect(expectation.paidAmount.eq("20000.00")).toBe(true);
    expect(expectation.amount.minus(expectation.paidAmount).eq("36000.00")).toBe(true);

    const allocationKey = `qa-allocation-${suffix}`;
    const allocated = await pay("158000.00", allocationKey);
    expect(allocated.status).toBe(201);
    expect(allocated.body.data).toMatchObject({
      totalAmount: "158000.00",
      appliedToCurrentDue: "36000.00",
      extraPayment: "122000.00",
      remainingDue: "0.00",
      previousCardBalance: "588543.22",
      newCardBalance: "430543.22",
      idempotent: false,
    });
    expectation = await prisma.cardPaymentExpectation.findUniqueOrThrow({
      where: { id: expectation.id },
    });
    expect(expectation.status).toBe("PAID");
    expect(expectation.paidAmount.eq("56000.00")).toBe(true);
    const duplicate = await pay("158000.00", allocationKey);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data).toMatchObject({
      transactionId: allocated.body.data.transactionId,
      totalAmount: "158000.00",
      appliedToCurrentDue: "36000.00",
      extraPayment: "122000.00",
      idempotent: true,
    });
    expect(await prisma.transaction.count({ where: { workspaceId } })).toBe(2);
    const [updatedBank, updatedCard] = await Promise.all([
      prisma.financialAccount.findUniqueOrThrow({ where: { id: bank.body.data.id } }),
      prisma.financialAccount.findUniqueOrThrow({ where: { id: card.body.data.id } }),
    ]);
    expect(updatedBank.currentBalance.eq("1822000.00")).toBe(true);
    expect(updatedCard.currentBalance.eq("430543.22")).toBe(true);
    expect((await pay("430543.23", `qa-over-debt-${suffix}`)).status).toBe(409);
    expect(
      await prisma.financialEvent.count({
        where: { workspaceId, relatedCardPaymentExpectationId: expectation.id, isCompleted: false },
      }),
    ).toBe(0);
  }, 60_000);
});
