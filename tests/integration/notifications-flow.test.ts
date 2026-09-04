import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Notifications secure password 1!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const actor = { id: "", workspaceId: "", access: "" };
const outsider = { id: "", workspaceId: "", access: "" };
let notificationId = "";

const base = () => `/api/v1/workspaces/${actor.workspaceId}/notifications`;

const currentMonthRange = () => {
  const now = new Date();
  return {
    startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    endsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
    occurredAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.max(1, now.getUTCDate()), 12)),
  };
};

describe.sequential("centro de alertas inteligentes · flujo backend", () => {
  afterAll(async () => {
    const workspaceIds = [actor.workspaceId, outsider.workspaceId].filter(Boolean);
    const userIds = [actor.id, outsider.id].filter(Boolean);
    if (workspaceIds.length) await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("prepara usuario y una condición real de presupuesto que requiere atención", async () => {
    const registered = await registerVerified({
      email: `notifications-owner-${suffix}@example.com`,
      password,
      firstName: "Notifications",
    });
    actor.id = registered.user.id;
    actor.workspaceId = registered.workspace.id;
    actor.access = registered.login.body.data.tokens.accessToken;

    const other = await registerVerified({
      email: `notifications-other-${suffix}@example.com`,
      password,
      firstName: "Other",
    });
    outsider.id = other.user.id;
    outsider.workspaceId = other.workspace.id;
    outsider.access = other.login.body.data.tokens.accessToken;

    const account = await prisma.financialAccount.create({
      data: {
        workspaceId: actor.workspaceId,
        name: "Cuenta alertas QA",
        type: "CHECKING",
        nature: "ASSET",
        currency: "COP",
        openingBalance: "1000000.00",
        currentBalance: "910000.00",
      },
    });
    const category = await prisma.category.findFirstOrThrow({
      where: { workspaceId: null, type: "EXPENSE" },
    });
    const range = currentMonthRange();
    const budget = await prisma.budget.create({
      data: {
        workspaceId: actor.workspaceId,
        name: "Mercado QA",
        period: "MONTHLY",
        startsOn: range.startsOn,
        endsOn: range.endsOn,
        amount: "100000.00",
        currency: "COP",
        alertThreshold: "80.00",
        budgetAccounts: { create: { accountId: account.id } },
        budgetCategories: { create: { categoryId: category.id } },
      },
    });
    await prisma.transaction.create({
      data: {
        workspaceId: actor.workspaceId,
        type: "EXPENSE",
        status: "CONFIRMED",
        amount: "90000.00",
        accountId: account.id,
        categoryId: category.id,
        occurredAt: range.occurredAt,
        merchantName: "Mercado QA",
        description: "Gasto para disparar alerta de presupuesto",
        createdBy: actor.id,
      },
    });

    expect(budget.id).toBeTruthy();
  }, 60_000);

  it("genera una alerta accionable, con contexto y sin duplicarla al refrescar", async () => {
    const first = await request(app).post(`${base()}/refresh`).set(auth(actor.access)).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.created).toBeGreaterThanOrEqual(1);

    const listed = await request(app).get(`${base()}?status=ALL&page=1&limit=20`).set(auth(actor.access));
    expect(listed.status).toBe(200);
    const budgetAlert = listed.body.data.items.find(
      (item: { type: string; title: string }) =>
        item.type === "BUDGET_ALERT" && item.title.includes("Mercado QA"),
    );
    expect(budgetAlert).toBeTruthy();
    expect(budgetAlert).toMatchObject({
      severity: "WARNING",
      source: "BUDGET",
      actionUrl: "/app/budgets",
      actionLabel: "Ver presupuesto",
      readAt: null,
      dismissedAt: null,
    });
    expect(budgetAlert.context.percentage).toBeGreaterThanOrEqual(80);
    notificationId = budgetAlert.id;

    const beforeCount = await prisma.notification.count({
      where: { userId: actor.id, workspaceId: actor.workspaceId, type: "BUDGET_ALERT" },
    });
    const second = await request(app).post(`${base()}/refresh`).set(auth(actor.access)).send({});
    expect(second.status).toBe(200);
    const afterCount = await prisma.notification.count({
      where: { userId: actor.id, workspaceId: actor.workspaceId, type: "BUDGET_ALERT" },
    });
    expect(afterCount).toBe(beforeCount);
  });

  it("mantiene el estado de lectura y descarte entre consultas", async () => {
    const summaryBefore = await request(app).get(`${base()}/summary`).set(auth(actor.access));
    expect(summaryBefore.status).toBe(200);
    expect(summaryBefore.body.data.unread).toBeGreaterThanOrEqual(1);

    const read = await request(app)
      .post(`${base()}/${notificationId}/read`)
      .set(auth(actor.access))
      .send({});
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).toBeTruthy();

    const storedRead = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
    expect(storedRead.readAt).not.toBeNull();

    const dismissed = await request(app)
      .post(`${base()}/${notificationId}/dismiss`)
      .set(auth(actor.access))
      .send({});
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.dismissedAt).toBeTruthy();

    const hidden = await request(app).get(`${base()}?status=ALL&page=1&limit=20`).set(auth(actor.access));
    expect(hidden.status).toBe(200);
    expect(hidden.body.data.items.some((item: { id: string }) => item.id === notificationId)).toBe(false);

    const visible = await request(app)
      .get(`${base()}?status=ALL&includeDismissed=true&page=1&limit=20`)
      .set(auth(actor.access));
    expect(visible.status).toBe(200);
    expect(visible.body.data.items.some((item: { id: string; dismissedAt: string | null }) =>
      item.id === notificationId && Boolean(item.dismissedAt),
    )).toBe(true);
  });

  it("protege las alertas con aislamiento por workspace", async () => {
    const response = await request(app)
      .get(`/api/v1/workspaces/${actor.workspaceId}/notifications`)
      .set(auth(outsider.access));
    expect(response.status).toBe(404);
  });
});
