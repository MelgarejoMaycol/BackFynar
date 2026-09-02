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
let transferId = "";

const goalsBase = () => `/api/v1/workspaces/${actor.workspaceId}/goals`;
const transactionsBase = () => `/api/v1/workspaces/${actor.workspaceId}/transactions`;

describe.sequential("metas de ahorro · simulación de usuario", () => {
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

    const checking = await prisma.financialAccount.create({
      data: {
        workspaceId: actor.workspaceId,
        name: "Bancolombia Metas QA",
        type: "CHECKING",
        nature: "ASSET",
        currency: "COP",
        openingBalance: "2000000.00",
        currentBalance: "2000000.00",
      },
    });
    checkingId = checking.id;
    const savings = await prisma.financialAccount.create({
      data: {
        workspaceId: actor.workspaceId,
        name: "Ahorros Metas QA",
        type: "SAVINGS",
        nature: "ASSET",
        currency: "COP",
        openingBalance: "500000.00",
        currentBalance: "500000.00",
      },
    });
    savingsId = savings.id;
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

    const list = await request(app).get(goalsBase()).set(auth(actor.access));
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toContain(goalId);
  });

  it("registra una asignación sin descontar dinero de la cuenta", async () => {
    const before = await prisma.financialAccount.findUniqueOrThrow({ where: { id: savingsId } });
    const response = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "300000.00", contributedAt: "2026-06-02T12:00:00-05:00" });
    expect(response.status).toBe(201);
    expect(response.body.data.savedAmount).toBe("300000.00");
    expect(response.body.data.progress.percentage).toBe("3.75");
    firstContributionId = response.body.data.contributions.find(
      (entry: { amount: string }) => entry.amount === "300000.00",
    ).id;
    const after = await prisma.financialAccount.findUniqueOrThrow({ where: { id: savingsId } });
    expect(after.currentBalance.toFixed(2)).toBe(before.currentBalance.toFixed(2));
  });

  it("pausa y bloquea nuevos aportes, pero permite reactivar", async () => {
    const paused = await request(app)
      .post(`${goalsBase()}/${goalId}/pause`)
      .set(auth(actor.access));
    expect(paused.status).toBe(200);
    expect(paused.body.data.status).toBe("PAUSED");

    const blocked = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "100000.00" });
    expect(blocked.status).toBe(409);

    const resumed = await request(app)
      .post(`${goalsBase()}/${goalId}/resume`)
      .set(auth(actor.access));
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe("ACTIVE");
  });

  it("mueve dinero entre cuentas y vincula el movimiento a la meta sin doble contabilización", async () => {
    const transfer = await request(app)
      .post(`${transactionsBase()}/transfer`)
      .set(auth(actor.access))
      .send({
        accountId: checkingId,
        destinationAccountId: savingsId,
        categoryId: transferCategoryId,
        amount: "500000.00",
        occurredAt: "2026-08-02T12:00:00-05:00",
        description: "Ahorro para la moto",
      });
    expect(transfer.status).toBe(201);
    transferId = transfer.body.data.id;

    const contribution = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({
        amount: "500000.00",
        transactionId: transferId,
        contributedAt: "2026-08-02T12:00:00-05:00",
      });
    expect(contribution.status).toBe(201);
    expect(contribution.body.data.savedAmount).toBe("800000.00");

    const checking = await prisma.financialAccount.findUniqueOrThrow({ where: { id: checkingId } });
    const savings = await prisma.financialAccount.findUniqueOrThrow({ where: { id: savingsId } });
    expect(checking.currentBalance.toFixed(2)).toBe("1500000.00");
    expect(savings.currentBalance.toFixed(2)).toBe("1000000.00");
    expect(await prisma.transaction.count({ where: { id: transferId } })).toBe(1);
  });

  it("rechaza vincular más dinero que el movimiento o recursos de otro workspace", async () => {
    const tooMuch = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "1.00", transactionId: transferId });
    expect(tooMuch.status).toBe(400);

    const foreignAccount = await request(app)
      .post(goalsBase())
      .set(auth(actor.access))
      .send({ name: "Meta insegura", targetAmount: "1000.00", accountId: outsiderAccountId });
    expect(foreignAccount.status).toBe(404);

    const foreignWorkspace = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/goals/${goalId}`)
      .set(auth(outsider.access));
    expect(foreignWorkspace.status).toBe(403);
  });

  it("permite retirar asignación de forma trazable y bloquea sobregiros", async () => {
    const withdrawal = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "-100000.00", contributedAt: "2026-09-01T12:00:00-05:00" });
    expect(withdrawal.status).toBe(201);
    expect(withdrawal.body.data.savedAmount).toBe("700000.00");
    expect(withdrawal.body.data.contributions.some((entry: { direction: string }) => entry.direction === "OUT")).toBe(true);

    const overdraw = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions`)
      .set(auth(actor.access))
      .send({ amount: "-700001.00" });
    expect(overdraw.status).toBe(400);
  });

  it("revierte un aporte exactamente una vez y recalcula el cache", async () => {
    const reversed = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions/${firstContributionId}/reverse`)
      .set(auth(actor.access));
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.savedAmount).toBe("400000.00");

    const repeated = await request(app)
      .post(`${goalsBase()}/${goalId}/contributions/${firstContributionId}/reverse`)
      .set(auth(actor.access));
    expect(repeated.status).toBe(409);

    const stored = await prisma.savingsGoal.findUniqueOrThrow({ where: { id: goalId } });
    expect(stored.savedAmount.toFixed(2)).toBe("400000.00");
  });

  it("muestra proyección determinista cuando ya existe historial suficiente", async () => {
    const projection = await request(app)
      .get(`${goalsBase()}/${goalId}/projection`)
      .set(auth(actor.access));
    expect(projection.status).toBe(200);
    expect(projection.body.data.savedAmount).toBe("400000.00");
    expect(projection.body.data.suggestedMonthlyAmount).not.toBeNull();
    expect(["ESTIMATED", "NON_POSITIVE_PACE"]).toContain(projection.body.data.estimationReason);
  });

  it("edita, archiva, oculta y restaura sin perder historial", async () => {
    const edited = await request(app)
      .patch(`${goalsBase()}/${goalId}`)
      .set(auth(actor.access))
      .send({ name: "Moto nueva", targetAmount: "7500000.00" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe("Moto nueva");

    const archived = await request(app)
      .delete(`${goalsBase()}/${goalId}`)
      .set(auth(actor.access));
    expect(archived.status).toBe(200);

    const normalList = await request(app).get(goalsBase()).set(auth(actor.access));
    expect(normalList.body.data.items.map((item: { id: string }) => item.id)).not.toContain(goalId);

    const archivedList = await request(app)
      .get(`${goalsBase()}?includeArchived=true`)
      .set(auth(actor.access));
    expect(archivedList.body.data.items.map((item: { id: string }) => item.id)).toContain(goalId);

    const restored = await request(app)
      .post(`${goalsBase()}/${goalId}/restore`)
      .set(auth(actor.access));
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe("ACTIVE");
    expect(restored.body.data.contributions.length).toBeGreaterThanOrEqual(4);
  });
});
