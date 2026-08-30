import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Informal balance secure password 1!";
const actor = {
  email: `informal-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
};
let accountId = "";
let payableId = "";
let receivableId = "";

const auth = () => ({ Authorization: `Bearer ${actor.access}` });
const base = () => `/api/v1/workspaces/${actor.workspaceId}/informal-balances`;

describe.sequential("Debo y me deben sin intereses", () => {
  afterAll(async () => {
    if (actor.workspaceId) {
      await prisma.workspace.deleteMany({ where: { id: actor.workspaceId } });
    }
    if (actor.id) await prisma.user.deleteMany({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  it("prepara una persona normal con una cuenta", async () => {
    const { user, workspace, login } = await registerVerified({
      email: actor.email,
      password,
      firstName: "Persona",
    });
    actor.id = user.id;
    actor.workspaceId = workspace.id;
    actor.access = login.body.data.tokens.accessToken;

    accountId = (
      await prisma.financialAccount.create({
        data: {
          workspaceId: actor.workspaceId,
          name: "Cuenta diaria",
          type: "SAVINGS",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "100000.00",
          currentBalance: "100000.00",
        },
      })
    ).id;
  }, 60_000);

  it("registra que debo 30.000 de gasolina sin crear intereses", async () => {
    const response = await request(app)
      .post(base())
      .set(auth())
      .send({
        direction: "PAYABLE",
        counterpartyName: "Carlos",
        description: "Gasolina de la moto",
        amount: "30000.00",
        currency: "COP",
        occurredOn: "2026-08-30",
        dueOn: "2026-09-05",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      direction: "PAYABLE",
      counterpartyName: "Carlos",
      originalAmount: "30000.00",
      currentBalance: "30000.00",
      paidAmount: "0.00",
      status: "OPEN",
    });
    payableId = response.body.data.id;

    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("100000.00");
  });

  it("paga solo 10.000 y deja 20.000 pendientes, moviendo la cuenta elegida", async () => {
    const payment = await request(app)
      .post(`${base()}/${payableId}/payments`)
      .set(auth())
      .send({
        amount: "10000.00",
        paidAt: "2026-08-30T18:30:00.000Z",
        accountId,
        idempotencyKey: `gas-${suffix}`,
      });

    expect(payment.status).toBe(201);
    expect(payment.body.data.balance).toMatchObject({
      currentBalance: "20000.00",
      paidAmount: "10000.00",
      status: "PARTIAL",
    });
    expect(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2),
    ).toBe("90000.00");

    const tooMuch = await request(app)
      .post(`${base()}/${payableId}/payments`)
      .set(auth())
      .send({
        amount: "20000.01",
        paidAt: "2026-08-30T18:31:00.000Z",
        idempotencyKey: `too-much-${suffix}`,
      });
    expect(tooMuch.status).toBe(409);
  });

  it("termina el pendiente sin tocar cuentas cuando el pago fue por fuera", async () => {
    const payment = await request(app)
      .post(`${base()}/${payableId}/payments`)
      .set(auth())
      .send({
        amount: "20000.00",
        paidAt: "2026-09-02T14:00:00.000Z",
        accountId: null,
        idempotencyKey: `finish-${suffix}`,
      });

    expect(payment.status).toBe(201);
    expect(payment.body.data.balance).toMatchObject({
      currentBalance: "0.00",
      paidAmount: "30000.00",
      status: "SETTLED",
    });
    expect(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2),
    ).toBe("90000.00");
  });

  it("también registra cuando me deben y al cobrar aumenta mi cuenta", async () => {
    const created = await request(app)
      .post(base())
      .set(auth())
      .send({
        direction: "RECEIVABLE",
        counterpartyName: "Ana",
        description: "Le presté para el almuerzo",
        amount: "5000.00",
        currency: "COP",
        occurredOn: "2026-08-30",
      });
    expect(created.status).toBe(201);
    receivableId = created.body.data.id;

    const collected = await request(app)
      .post(`${base()}/${receivableId}/payments`)
      .set(auth())
      .send({
        amount: "5000.00",
        paidAt: "2026-08-30T19:00:00.000Z",
        accountId,
        idempotencyKey: `collect-${suffix}`,
      });
    expect(collected.status).toBe(201);
    expect(collected.body.data.balance.status).toBe("SETTLED");
    expect(
      (await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2),
    ).toBe("95000.00");
  });

  it("resume por moneda y permite encontrar el pendiente por persona o motivo", async () => {
    const summary = await request(app).get(`${base()}/summary`).set(auth());
    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual([]);

    const search = await request(app)
      .get(`${base()}?status=SETTLED&search=gasolina`)
      .set(auth());
    expect(search.status).toBe(200);
    expect(search.body.data.some((item: { id: string }) => item.id === payableId)).toBe(true);
  });
});
