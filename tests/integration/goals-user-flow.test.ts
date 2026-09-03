import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Goals secure password 1!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const actor = { id: "", workspaceId: "", access: "" };
const outsider = { id: "", workspaceId: "", access: "" };
let checkingId = "";
let savingsId = "";
let outsiderAccountId = "";
let transferCategoryId = "";
let goalId = "";
let firstContributionId = "";

const goalsBase = () => `/api/v1/workspaces/${actor.workspaceId}/goals`;
const accountsBase = () => `/api/v1/workspaces/${actor.workspaceId}/accounts`;
const transactionsBase = () => `/api/v1/workspaces/${actor.workspaceId}/transactions`;

describe.sequential("metas de ahorro · reservas por cuenta", () => {
  afterAll(async () => {
    const workspaceIds = [actor.workspaceId, outsider.workspaceId].filter(Boolean);
    const userIds = [actor.id, outsider.id].filter(Boolean);
    if (workspaceIds.length) {
      await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.goalContribution.deleteMany({ where: { savingsGoals: { workspaceId: { in: workspaceIds } } } });
      await prisma.savingsGoal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.transaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.financialAccount.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("prepara dos usuarios reales y sus cuentas", async () => {
    const registered = await registerVerified({
      email: `goals-owner-${suffix}@example.com`,
      password,
      firstName: "Goals",
    });
    actor.id = registered.user.id;
    actor.workspaceId = registered.workspace.id;
    actor.access = registered.login.body.data.tokens.accessToken;

    const other = await registerVerified({
      email: `goals-other-${suffix}@example.com`,
      password,
      firstName: "Other",
    });
    outsider.id = other.user.id;
    outsider.workspaceId = other.workspace.id;
    outsider.access = other.login.body.data.tokens.accessToken;

    checkingId = (
      await prisma.financialAccount.create({
        data: {
          workspaceId: actor.workspaceId,
          name: "Bancolombia Metas QA",
          type: "CHECKING",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "2000000.00",
          currentBalance: "2000000.00",
        },
      })
    ).id;
    savingsId = (
      await prisma.financialAccount.create({
        data: {
          workspaceId: actor.workspaceId,
          name: "Ahorros Metas QA",
          type: "SAVINGS",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "500000.00",
          currentBalance: "500000.00",
        },
      })
    ).id;
    outsiderAccountId = (
      await prisma.financialAccount.create({
        data: {
          workspaceId: outsider.workspaceId,
          name: "Cuenta ajena QA",
          type: "SAVINGS",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "100000.00",
          currentBalance: "100000.00",
        },
      })
    ).id;
    transferCategoryId = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "TRANSFER" } })
    ).id;
  }, 60_000);

  it("crea una meta y calcula progreso inicial sin inventar proyección", async () => {
    const response = await request(app)
      .post(goalsBase())
      .set(auth(actor.access))
      .send({
        name: "Comprar moto",
        targetAmount: "8000000.00",
        targetDate: "2027-09-02",
        accountId: savingsId,
        icon: "bike",
        color: "#154B45",
      });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: "Comprar moto",
      targetAmount: "8000000.00",
      savedAmount: "0.00",
      status: "ACTIVE",
      account: { id: savingsId },
      progress: {
        remainingAmount: "8000000.00",
        percentage: "0.00",
        estimationReason: "INSUFFICIENT_HISTORY",
      },
    });
    goalId = response.body.data.id;
  });

  it("reserva dinero de una cuenta sin cambiar su saldo real", async () => {
    const before = await prisma.financialAccount.findUniqueOrThrow({ where: { id: savingsId } });
    const response = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({
        amount: "300000.00",
        accountId: savingsId,
        contributedAt: "2026-06-02T12:00:00-05:00",
      });
    expect(response.status).toBe(201);
    expect(response.body.data.savedAmount).toBe("300000.00");
    expect(response.body.data.progress.percentage).toBe("3.75");
    const first = response.body.data.contributions.find(
      (entry: { amount: string }) => entry.amount === "300000.00",
    );
    expect(first).toMatchObject({ accountId: savingsId, transactionId: null });
    firstContributionId = first.id;

    const after = await prisma.financialAccount.findUniqueOrThrow({ where: { id: savingsId } });
    expect(after.currentBalance.toFixed(2)).toBe(before.currentBalance.toFixed(2));

    const account = await request(app)
      .get(`${accountsBase()}/${savingsId}`)
      .set(auth(actor.access));
    expect(account.status).toBe(200);
    expect(account.body.data).toMatchObject({
      currentBalance: "500000.00",
      reservedForGoals: "300000.00",
      availableBalance: "200000.00",
    });
  });

  it("impide reservar más dinero del realmente disponible", async () => {
    const response = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "200000.01", accountId: savingsId });
    expect(response.status).toBe(400);
    expect(response.body.error?.message ?? response.body.message).toContain("disponible");
  });

  it("pausa y bloquea nuevos aportes, pero permite reactivar", async () => {
    const paused = await request(app)
      .post(`${goalsBase()}/${goalId}/pause`)
      .set(auth(actor.access));
    expect(paused.status).toBe(200);

    const blocked = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "100000.00", accountId: savingsId });
    expect(blocked.status).toBe(409);

    const resumed = await request(app)
      .post(`${goalsBase()}/${goalId}/resume`)
      .set(auth(actor.access));
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe("ACTIVE");
  });

  it("permite mover dinero real y luego reservarlo sin duplicar movimientos", async () => {
    const transfer = await request(app)
      .post(`${transactionsBase()}/transfer`)
      .set(auth(actor.access))
      .send({
        accountId: checkingId,
        destinationAccountId: savingsId,
        categoryId: transferCategoryId,
        amount: "500000.00",
        occurredAt: "2026-08-02T12:00:00-05:00",
        description: "Mover dinero a ahorros",
      });
    expect(transfer.status).toBe(201);

    const contribution = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({
        amount: "500000.00",
        accountId: savingsId,
        contributedAt: "2026-08-02T12:01:00-05:00",
      });
    expect(contribution.status).toBe(201);
    expect(contribution.body.data.savedAmount).toBe("800000.00");

    const checking = await prisma.financialAccount.findUniqueOrThrow({ where: { id: checkingId } });
    const savings = await prisma.financialAccount.findUniqueOrThrow({ where: { id: savingsId } });
    expect(checking.currentBalance.toFixed(2)).toBe("1500000.00");
    expect(savings.currentBalance.toFixed(2)).toBe("1000000.00");
    expect(await prisma.transaction.count({ where: { workspaceId: actor.workspaceId } })).toBe(1);

    const account = await request(app)
      .get(`${accountsBase()}/${savingsId}`)
      .set(auth(actor.access));
    expect(account.body.data).toMatchObject({
      currentBalance: "1000000.00",
      reservedForGoals: "800000.00",
      availableBalance: "200000.00",
    });
  });

  it("rechaza cuentas ajenas tanto en metas como en aportes", async () => {
    const foreignGoalAccount = await request(app)
      .post(goalsBase())
      .set(auth(actor.access))
      .send({ name: "Meta insegura", targetAmount: "1000.00", accountId: outsiderAccountId });
    expect(foreignGoalAccount.status).toBe(404);

    const foreignContributionAccount = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "1.00", accountId: outsiderAccountId });
    expect(foreignContributionAccount.status).toBe(404);

    const foreignWorkspace = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/goals/${goalId}`)
      .set(auth(outsider.access));
    expect(foreignWorkspace.status).toBe(404);
  });

  it("muestra en Inicio saldo total, reservado y disponible sin tocar patrimonio", async () => {
    const dashboard = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/dashboard?period=CURRENT_MONTH`)
      .set(auth(actor.access));
    expect(dashboard.status).toBe(200);
    const cop = dashboard.body.data.summariesByCurrency.find(
      (item: { currency: string }) => item.currency === "COP",
    );
    expect(cop).toMatchObject({
      totalMoney: "2500000.00",
      reservedForGoals: "800000.00",
      availableMoney: "1700000.00",
      netWorth: "2500000.00",
    });
  });

  it("permite liberar una reserva únicamente desde la cuenta que la contiene", async () => {
    const withdrawal = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({
        amount: "-100000.00",
        accountId: savingsId,
        contributedAt: "2026-09-01T12:00:00-05:00",
      });
    expect(withdrawal.status).toBe(201);
    expect(withdrawal.body.data.savedAmount).toBe("700000.00");

    const wrongAccount = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "-1.00", accountId: checkingId });
    expect(wrongAccount.status).toBe(400);

    const overdraw = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "-700001.00", accountId: savingsId });
    expect(overdraw.status).toBe(400);
  });

  it("revierte un aporte exactamente una vez usando la misma cuenta", async () => {
    const reversed = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions/${firstContributionId}/reverse`)
      .set(auth(actor.access));
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.savedAmount).toBe("400000.00");
    const compensating = reversed.body.data.contributions.find(
      (entry: { amount: string }) => entry.amount === "-300000.00",
    );
    expect(compensating.accountId).toBe(savingsId);

    const repeated = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions/${firstContributionId}/reverse`)
      .set(auth(actor.access));
    expect(repeated.status).toBe(409);
  });

  it("archivar libera el dinero y restaurar vuelve a reservarlo", async () => {
    const beforeArchive = await request(app)
      .get(`${accountsBase()}/${savingsId}`)
      .set(auth(actor.access));
    expect(beforeArchive.body.data.reservedForGoals).toBe("400000.00");
    expect(beforeArchive.body.data.availableBalance).toBe("600000.00");

    const archived = await request(app)
      .delete(`${goalsBase()}/${goalId}`)
      .set(auth(actor.access));
    expect(archived.status).toBe(200);

    const whileArchived = await request(app)
      .get(`${accountsBase()}/${savingsId}`)
      .set(auth(actor.access));
    expect(whileArchived.body.data.reservedForGoals).toBe("0.00");
    expect(whileArchived.body.data.availableBalance).toBe("1000000.00");

    const restored = await request(app)
      .post(`${goalsBase()}/${goalId}/restore`)
      .set(auth(actor.access));
    expect(restored.status).toBe(200);

    const afterRestore = await request(app)
      .get(`${accountsBase()}/${savingsId}`)
      .set(auth(actor.access));
    expect(afterRestore.body.data.reservedForGoals).toBe("400000.00");
    expect(afterRestore.body.data.availableBalance).toBe("600000.00");
  });

  it("mantiene la proyección y el historial después de las reservas", async () => {
    const projection = await request(app)
      .get(`${goalsBase()}/${goalId}/projection`)
      .set(auth(actor.access));
    expect(projection.status).toBe(200);
    expect(projection.body.data.savedAmount).toBe("400000.00");
    expect(projection.body.data.suggestedMonthlyAmount).not.toBeNull();

    const detail = await request(app)
      .get(`${goalsBase()}/${goalId}`)
      .set(auth(actor.access));
    expect(detail.status).toBe(200);
    expect(detail.body.data.contributions.length).toBeGreaterThanOrEqual(4);
    expect(
      detail.body.data.contributions.filter((entry: { accountId?: string }) => entry.accountId === savingsId)
        .length,
    ).toBeGreaterThanOrEqual(4);
  });
});