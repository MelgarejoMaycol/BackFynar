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

  it("permite corregir y eliminar un aporte manteniendo movimiento y saldo sincronizados", async () => {
    const created = await request(app)
      .post(`${investmentsBase()}/${planId}/contributions`)
      .set(auth(actor.access))
      .send({
        sourceAccountId: accountId,
        amount: "100000.00",
        occurredAt: "2026-09-14T15:00:00-05:00",
        note: "Aporte temporal",
      });

    expect(created.status).toBe(201);
    const contribution = created.body.data.recentContributions.find(
      (item: { note: string | null }) => item.note === "Aporte temporal",
    );
    expect(contribution.transactionId).toBeTypeOf("string");

    const updated = await request(app)
      .patch(
        `${investmentsBase()}/${planId}/contributions/${contribution.id}`,
      )
      .set(auth(actor.access))
      .send({
        amount: "120000.00",
        occurredAt: "2026-09-15T09:30:00-05:00",
        note: "Aporte corregido",
      });

    expect(updated.status).toBe(200);
    expect(
      updated.body.data.recentContributions.find(
        (item: { id: string }) => item.id === contribution.id,
      ),
    ).toMatchObject({
      amount: "120000.00",
      note: "Aporte corregido",
    });

    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: contribution.transactionId },
    });
    expect(transaction.amount.toFixed(2)).toBe("120000.00");
    expect(transaction.notes).toBe("Aporte corregido");
    expect(transaction.occurredAt.toISOString()).toBe(
      "2026-09-15T14:30:00.000Z",
    );

    const afterUpdate = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(afterUpdate.currentBalance.toFixed(2)).toBe("1380000.00");

    const removed = await request(app)
      .delete(
        `${investmentsBase()}/${planId}/contributions/${contribution.id}`,
      )
      .set(auth(actor.access));

    expect(removed.status).toBe(200);
    expect(
      removed.body.data.recentContributions.some(
        (item: { id: string }) => item.id === contribution.id,
      ),
    ).toBe(false);

    const afterDelete = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(afterDelete.currentBalance.toFixed(2)).toBe("1500000.00");
    const cancelled = await prisma.transaction.findUniqueOrThrow({
      where: { id: contribution.transactionId },
    });
    expect(cancelled.status).toBe("CANCELLED");
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

  it("permite corregir y eliminar retiros y valoraciones", async () => {
    const withdrawalCreated = await request(app)
      .post(`${investmentsBase()}/${planId}/withdrawals`)
      .set(auth(actor.access))
      .send({
        destinationAccountId: accountId,
        amount: "50000.00",
        occurredAt: "2026-09-16T15:00:00-05:00",
        note: "Retiro temporal",
      });

    expect(withdrawalCreated.status).toBe(201);
    const withdrawal = withdrawalCreated.body.data.recentWithdrawals.find(
      (item: { note: string | null }) => item.note === "Retiro temporal",
    );

    const withdrawalUpdated = await request(app)
      .patch(
        `${investmentsBase()}/${planId}/withdrawals/${withdrawal.id}`,
      )
      .set(auth(actor.access))
      .send({
        amount: "60000.00",
        occurredAt: "2026-09-17T10:00:00-05:00",
        note: "Retiro corregido",
      });
    expect(withdrawalUpdated.status).toBe(200);
    expect(
      withdrawalUpdated.body.data.recentWithdrawals.find(
        (item: { id: string }) => item.id === withdrawal.id,
      ),
    ).toMatchObject({ amount: "60000.00", note: "Retiro corregido" });

    const linkedWithdrawal = await prisma.transaction.findUniqueOrThrow({
      where: { id: withdrawal.transactionId },
    });
    expect(linkedWithdrawal.amount.toFixed(2)).toBe("60000.00");

    const withdrawalRemoved = await request(app)
      .delete(
        `${investmentsBase()}/${planId}/withdrawals/${withdrawal.id}`,
      )
      .set(auth(actor.access));
    expect(withdrawalRemoved.status).toBe(200);

    const afterWithdrawalDelete = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(afterWithdrawalDelete.currentBalance.toFixed(2)).toBe("1700000.00");

    const valuationCreated = await request(app)
      .post(`${investmentsBase()}/${planId}/valuations`)
      .set(auth(actor.access))
      .send({
        value: "360000.00",
        capturedAt: "2026-09-17T11:00:00-05:00",
        note: "Valor temporal",
      });
    expect(valuationCreated.status).toBe(201);
    const valuation = valuationCreated.body.data.recentValuations.find(
      (item: { note: string | null }) => item.note === "Valor temporal",
    );

    const valuationUpdated = await request(app)
      .patch(`${investmentsBase()}/${planId}/valuations/${valuation.id}`)
      .set(auth(actor.access))
      .send({
        value: "365000.00",
        capturedAt: "2026-09-17T12:00:00-05:00",
        note: "Valor corregido",
      });
    expect(valuationUpdated.status).toBe(200);
    expect(
      valuationUpdated.body.data.recentValuations.find(
        (item: { id: string }) => item.id === valuation.id,
      ),
    ).toMatchObject({ value: "365000.00", note: "Valor corregido" });

    const valuationRemoved = await request(app)
      .delete(`${investmentsBase()}/${planId}/valuations/${valuation.id}`)
      .set(auth(actor.access));
    expect(valuationRemoved.status).toBe(200);
    expect(
      valuationRemoved.body.data.recentValuations.some(
        (item: { id: string }) => item.id === valuation.id,
      ),
    ).toBe(false);
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
