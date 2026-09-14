import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Investment plan secure password 1!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const actor = { id: "", workspaceId: "", access: "" };
let accountId = "";
let planId = "";

const investmentsBase = () => `/api/v1/workspaces/${actor.workspaceId}/investments`;

describe.sequential("planes de inversión · aportes voluntarios", () => {
  afterAll(async () => {
    if (actor.workspaceId) {
      await prisma.investmentValuation.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.investmentWithdrawal.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.investmentContribution.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.investmentPlan.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.auditLog.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.transaction.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.financialAccount.deleteMany({ where: { workspaceId: actor.workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: actor.workspaceId } });
    }
    if (actor.id) await prisma.user.deleteMany({ where: { id: actor.id } });
    await prisma.$disconnect();
  });

  it("prepara usuario y cuenta líquida", async () => {
    const registered = await registerVerified({
      email: `investment-owner-${suffix}@example.com`,
      password,
      firstName: "Investor",
    });
    actor.id = registered.user.id;
    actor.workspaceId = registered.workspace.id;
    actor.access = registered.login.body.data.tokens.accessToken;

    accountId = (
      await prisma.financialAccount.create({
        data: {
          workspaceId: actor.workspaceId,
          name: "Cuenta para invertir",
          type: "SAVINGS",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "2000000.00",
          currentBalance: "2000000.00",
        },
      })
    ).id;
  }, 60_000);

  it("guarda un escenario como plan sin mover dinero ni crear obligaciones", async () => {
    const response = await request(app)
      .post(investmentsBase())
      .set(auth(actor.access))
      .send({
        name: "Fondo de largo plazo",
        description: "Escenario guardado desde el simulador",
        currency: "COP",
        plannedInitialAmount: "500000.00",
        recurringContribution: "100000.00",
        contributionFrequency: "WEEKLY",
        horizonYears: 5,
        annualReturn: "0.08",
        annualFee: "0",
        inflationRate: "0.04",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: "Fondo de largo plazo",
      status: "DRAFT",
      contributionFrequency: "WEEKLY",
      progress: {
        pace: {
          status: "NOT_STARTED",
        },
      },
    });
    expect(response.body.data.progress.pace.explanation).toContain("No hay fechas vencidas");
    planId = response.body.data.id;

    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("2000000.00");
    expect(await prisma.recurringObligation.count({ where: { workspaceId: actor.workspaceId } })).toBe(0);
    expect(await prisma.financialEvent.count({ where: { workspaceId: actor.workspaceId } })).toBe(0);
  });

  it("inicia el plan sin cobrar el aporte inicial", async () => {
    const response = await request(app)
      .post(`${investmentsBase()}/${planId}/start`)
      .set(auth(actor.access))
      .send({ startDate: "2026-09-14" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ACTIVE");
    expect(response.body.data.startDate).toBe("2026-09-14");

    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("2000000.00");
  });

  it("registra un aporte real separado de la cuenta y conserva el patrimonio", async () => {
    const response = await request(app)
      .post(`${investmentsBase()}/${planId}/contributions`)
      .set(auth(actor.access))
      .send({
        sourceAccountId: accountId,
        amount: "500000.00",
        occurredAt: "2026-09-14T12:00:00-05:00",
        note: "Primer aporte",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.progress.actual).toMatchObject({
      totalContributed: "500000.00",
      totalWithdrawn: "0.00",
      netContributed: "500000.00",
      currentValue: "500000.00",
      valuationBasis: "CASH_FLOWS_ONLY",
    });

    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("1500000.00");

    const transaction = await prisma.transaction.findFirstOrThrow({
      where: {
        workspaceId: actor.workspaceId,
        type: "INVESTMENT",
        metadata: { path: ["role"], equals: "CONTRIBUTION" },
      },
    });
    expect(transaction.amount.toFixed(2)).toBe("500000.00");

    const dashboard = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/dashboard?period=CURRENT_MONTH`)
      .set(auth(actor.access));
    expect(dashboard.status).toBe(200);
    const cop = dashboard.body.data.summariesByCurrency.find(
      (item: { currency: string }) => item.currency === "COP",
    );
    expect(cop).toMatchObject({
      availableMoney: "1500000.00",
      investmentValue: "500000.00",
      netWorth: "2000000.00",
    });
  });

  it("trata la frecuencia como ritmo sugerido, no como pago pendiente", async () => {
    const detail = await request(app)
      .get(`${investmentsBase()}/${planId}`)
      .set(auth(actor.access));

    expect(detail.status).toBe(200);
    const progress = detail.body.data.progress;
    expect(["AHEAD", "ON_TRACK", "BELOW_PREFERRED_PACE"]).toContain(progress.pace.status);
    if (progress.nextSuggestion) {
      expect(progress.nextSuggestion.message).toContain("no una obligación");
      expect(progress.nextSuggestion.message).toContain("no se genera deuda ni atraso");
    }
    expect(await prisma.recurringObligation.count({ where: { workspaceId: actor.workspaceId } })).toBe(0);
    expect(await prisma.financialEvent.count({ where: { workspaceId: actor.workspaceId } })).toBe(0);
  });

  it("permite registrar valor real y refleja rendimiento sin convertirlo en una cuenta", async () => {
    const response = await request(app)
      .post(`${investmentsBase()}/${planId}/valuations`)
      .set(auth(actor.access))
      .send({
        value: "550000.00",
        capturedAt: "2026-09-15T12:00:00-05:00",
        note: "Valor informado por el usuario",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.progress.actual).toMatchObject({
      currentValue: "550000.00",
      valuationBasis: "MANUAL_PLUS_FLOWS",
    });

    const dashboard = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/dashboard?period=CURRENT_MONTH`)
      .set(auth(actor.access));
    const cop = dashboard.body.data.summariesByCurrency.find(
      (item: { currency: string }) => item.currency === "COP",
    );
    expect(cop.investmentValue).toBe("550000.00");
    expect(cop.netWorth).toBe("2050000.00");
  });

  it("permite retirar parte de la inversión hacia una cuenta en cualquier momento", async () => {
    const response = await request(app)
      .post(`${investmentsBase()}/${planId}/withdrawals`)
      .set(auth(actor.access))
      .send({
        destinationAccountId: accountId,
        amount: "200000.00",
        occurredAt: "2026-09-16T12:00:00-05:00",
        note: "Retiro parcial",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.progress.actual).toMatchObject({
      totalContributed: "500000.00",
      totalWithdrawn: "200000.00",
      netContributed: "300000.00",
      currentValue: "350000.00",
    });

    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.currentBalance.toFixed(2)).toBe("1700000.00");

    const dashboard = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/dashboard?period=CURRENT_MONTH`)
      .set(auth(actor.access));
    const cop = dashboard.body.data.summariesByCurrency.find(
      (item: { currency: string }) => item.currency === "COP",
    );
    expect(cop.availableMoney).toBe("1700000.00");
    expect(cop.investmentValue).toBe("350000.00");
    expect(cop.netWorth).toBe("2050000.00");
  });

  it("pausar no crea deuda y todavía permite aportar si el usuario quiere", async () => {
    const paused = await request(app)
      .post(`${investmentsBase()}/${planId}/pause`)
      .set(auth(actor.access));
    expect(paused.status).toBe(200);
    expect(paused.body.data.status).toBe("PAUSED");
    expect(paused.body.data.progress.nextSuggestion).toBeNull();

    const optionalContribution = await request(app)
      .post(`${investmentsBase()}/${planId}/contributions`)
      .set(auth(actor.access))
      .send({ sourceAccountId: accountId, amount: "50000.00" });
    expect(optionalContribution.status).toBe(201);
    expect(optionalContribution.body.data.progress.actual.totalContributed).toBe("550000.00");

    expect(await prisma.recurringObligation.count({ where: { workspaceId: actor.workspaceId } })).toBe(0);
    expect(await prisma.financialEvent.count({ where: { workspaceId: actor.workspaceId } })).toBe(0);
  });

  it("reanuda, finaliza y conserva el historial real", async () => {
    const resumed = await request(app)
      .post(`${investmentsBase()}/${planId}/resume`)
      .set(auth(actor.access));
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe("ACTIVE");

    const completed = await request(app)
      .post(`${investmentsBase()}/${planId}/complete`)
      .set(auth(actor.access));
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe("COMPLETED");
    expect(completed.body.data.recentContributions.length).toBeGreaterThanOrEqual(2);
    expect(completed.body.data.recentWithdrawals.length).toBeGreaterThanOrEqual(1);
  });
});
