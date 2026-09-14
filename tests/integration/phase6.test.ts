import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { testUserFactory } from "../helpers/test-user.factory.js";

const actors = [testUserFactory(), testUserFactory()];
const workspaceIds: string[] = [];
const accountIds: string[] = [];
let incomeCategory: { id: string };
let expenseCategory: { id: string };

const auth = (access: string) => ({ Authorization: `Bearer ${access}` });
const endpoint = () => `/api/v1/workspaces/${workspaceIds[0]}/dashboard`;

async function createAccount(
  actorIndex: number,
  payload: {
    name: string;
    type: "CASH" | "CHECKING" | "SAVINGS" | "E_WALLET" | "CREDIT_CARD" | "LOAN";
    currency: string;
    openingBalance: string;
    nature?: "ASSET" | "LIABILITY";
  },
) {
  const response = await request(app)
    .post(`/api/v1/workspaces/${workspaceIds[actorIndex]}/accounts`)
    .set(auth(actors[actorIndex]!.access))
    .send(payload);
  expect(response.status).toBe(201);
  accountIds.push(response.body.data.id);
  return response.body.data.id as string;
}

async function createTransaction(payload: {
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "INVESTMENT";
  amount: string;
  accountId?: string;
  destinationAccountId?: string;
  categoryId?: string;
  occurredAt: string;
  description: string;
  status?: "PENDING" | "CONFIRMED" | "CANCELED";
}) {
  const response = await request(app)
    .post(`/api/v1/workspaces/${workspaceIds[0]}/transactions`)
    .set(auth(actors[0]!.access))
    .send(payload);
  expect(response.status).toBe(201);
  return response.body.data;
}

describe("Fase 6 dashboard financiero real", () => {
  beforeAll(async () => {
    for (const actor of actors) {
      const session = await actor.createSession();
      actor.access = session.access;
      workspaceIds.push(session.workspace.id);
    }

    const categoriesResponse = await request(app)
      .get(`/api/v1/workspaces/${workspaceIds[0]}/categories`)
      .set(auth(actors[0]!.access));
    expect(categoriesResponse.status).toBe(200);
    incomeCategory = categoriesResponse.body.data.find(
      (category: { type: string }) => category.type === "INCOME",
    );
    expenseCategory = categoriesResponse.body.data.find(
      (category: { type: string }) => category.type === "EXPENSE",
    );

    await createAccount(0, {
      name: "Efectivo COP",
      type: "CASH",
      currency: "COP",
      openingBalance: "1000",
    });
    await createAccount(0, {
      name: "Ahorros COP",
      type: "SAVINGS",
      currency: "COP",
      openingBalance: "500",
    });
    await createAccount(0, {
      name: "Tarjeta COP",
      type: "CREDIT_CARD",
      currency: "COP",
      openingBalance: "800",
      nature: "LIABILITY",
    });
    await createAccount(0, {
      name: "Cuenta cerrada COP",
      type: "SAVINGS",
      currency: "COP",
      openingBalance: "10000",
    });
    await prisma.financialAccount.update({
      where: { id: accountIds[3]! },
      data: { status: "CLOSED" },
    });
    await createAccount(0, {
      name: "USD",
      type: "SAVINGS",
      currency: "USD",
      openingBalance: "50",
    });
    await createAccount(1, {
      name: "Cuenta ajena",
      type: "SAVINGS",
      currency: "COP",
      openingBalance: "9999",
    });

    await createTransaction({
      type: "INCOME",
      amount: "500",
      accountId: accountIds[0]!,
      categoryId: incomeCategory.id,
      occurredAt: "2026-08-05T12:00:00Z",
      description: "Ingreso válido",
    });
    await createTransaction({
      type: "EXPENSE",
      amount: "400",
      accountId: accountIds[0]!,
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-07T12:00:00Z",
      description: "Gasto válido",
    });
    await createTransaction({
      type: "TRANSFER",
      amount: "300",
      accountId: accountIds[0]!,
      destinationAccountId: accountIds[1]!,
      occurredAt: "2026-08-10T12:00:00Z",
      description: "Transferencia interna",
    });
    await createTransaction({
      type: "INVESTMENT",
      amount: "200",
      accountId: accountIds[0]!,
      occurredAt: "2026-08-12T12:00:00Z",
      description: "Movimiento inversión legado",
    });
    const canceled = await createTransaction({
      type: "EXPENSE",
      amount: "999",
      accountId: accountIds[0]!,
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-13T12:00:00Z",
      description: "Cancelado",
    });
    await prisma.transaction.update({
      where: { id: canceled.id },
      data: { status: "CANCELED" },
    });
    await createTransaction({
      type: "INCOME",
      amount: "20",
      accountId: accountIds[4]!,
      categoryId: incomeCategory.id,
      occurredAt: "2026-08-15T12:00:00Z",
      description: "Ingreso USD",
    });
    await createTransaction({
      type: "EXPENSE",
      amount: "5",
      accountId: accountIds[4]!,
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-16T12:00:00Z",
      description: "Gasto USD",
    });

    await request(app)
      .post(`/api/v1/workspaces/${workspaceIds[1]}/transactions`)
      .set(auth(actors[1]!.access))
      .send({
        type: "INCOME",
        amount: "9999",
        accountId: accountIds[5]!,
        categoryId: incomeCategory.id,
        occurredAt: "2026-08-18T12:00:00Z",
        description: "Movimiento ajeno",
      });
  }, 60_000);

  it("calcula métricas por moneda sin transferencias, cancelados ni datos ajenos", async () => {
    const response = await request(app)
      .get(`${endpoint()}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31&recentLimit=20`)
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    expect(response.body.data.period).toEqual({
      type: "CUSTOM",
      dateFrom: "2026-08-01T05:00:00.000Z",
      dateTo: "2026-09-01T04:59:59.999Z",
      timezone: "America/Bogota",
    });
    expect(response.body.data.summariesByCurrency).toEqual([
      {
        currency: "COP",
        availableMoney: "1500.00",
        totalIncome: "500.00",
        totalExpenses: "400.00",
        netCashFlow: "100.00",
        netWorth: "700.00",
        investmentValue: "0.00",
        expectedCollections: "0.00",
        scheduledPayments: "0.00",
        projectedEndLiquidity: "1500.00",
        forecastDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
      {
        currency: "USD",
        availableMoney: "50.00",
        totalIncome: "20.00",
        totalExpenses: "5.00",
        netCashFlow: "15.00",
        netWorth: "50.00",
        investmentValue: "0.00",
        expectedCollections: "0.00",
        scheduledPayments: "0.00",
        projectedEndLiquidity: "50.00",
        forecastDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    ]);
    expect(response.body.data.accountBalances).toHaveLength(4);
    expect(response.body.data.accountBalances[0].id).toBe(accountIds[0]);
    expect(
      response.body.data.accountBalances.some(
        (account: { id: string }) => account.id === accountIds[3],
      ),
    ).toBe(false);
    expect(
      response.body.data.accountBalances.some(
        (account: { id: string }) => account.id === accountIds[5],
      ),
    ).toBe(false);
    expect(
      response.body.data.recentTransactions.every(
        (transaction: { status: string; type: string }) =>
          transaction.status === "CONFIRMED" && transaction.type !== "INVESTMENT",
      ),
    ).toBe(true);
    expect(
      response.body.data.recentTransactions.some(
        (transaction: { description: string }) => transaction.description === "Movimiento ajeno",
      ),
    ).toBe(false);
  }, 30_000);

  it("expone compromisos y cobros esperados sin convertirlos en flujo realizado", async () => {
    const response = await request(app)
      .get(`${endpoint()}?period=CURRENT_MONTH&recentLimit=10`)
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    for (const summary of response.body.data.summariesByCurrency as Array<{
      currency: string;
      scheduledPayments: string;
      expectedCollections: string;
      projectedEndLiquidity: string;
    }>) {
      expect(Number(summary.scheduledPayments)).toBeGreaterThanOrEqual(0);
      expect(Number(summary.expectedCollections)).toBeGreaterThanOrEqual(0);
      expect(Number(summary.projectedEndLiquidity)).toBeGreaterThanOrEqual(0);
    }
  });
});
