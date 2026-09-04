import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Health secure password 1!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const actor = { id: "", workspaceId: "", access: "" };
const outsider = { id: "", workspaceId: "", access: "" };
let accountId = "";

const base = () => `/api/v1/workspaces/${actor.workspaceId}/financial-health`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

async function createFlow(type: "INCOME" | "EXPENSE", amount: string, occurredAt: Date) {
  await prisma.transaction.create({
    data: {
      workspaceId: actor.workspaceId,
      type,
      status: "CONFIRMED",
      amount,
      currency: "COP",
      accountId,
      occurredAt,
      description: `Dato salud ${type}`,
      createdBy: actor.id,
    },
  });
}

describe.sequential("salud financiera · flujo backend", () => {
  afterAll(async () => {
    const workspaceIds = [actor.workspaceId, outsider.workspaceId].filter(Boolean);
    const userIds = [actor.id, outsider.id].filter(Boolean);
    if (workspaceIds.length) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("prepara historial financiero real suficiente para calcular", async () => {
    const registered = await registerVerified({
      email: `health-owner-${suffix}@example.com`,
      password,
      firstName: "Health",
    });
    actor.id = registered.user.id;
    actor.workspaceId = registered.workspace.id;
    actor.access = registered.login.body.data.tokens.accessToken;

    const other = await registerVerified({
      email: `health-other-${suffix}@example.com`,
      password,
      firstName: "Other",
    });
    outsider.id = other.user.id;
    outsider.workspaceId = other.workspace.id;
    outsider.access = other.login.body.data.tokens.accessToken;

    accountId = (
      await prisma.financialAccount.create({
        data: {
          workspaceId: actor.workspaceId,
          name: "Liquidez salud QA",
          type: "CHECKING",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "6000000.00",
          currentBalance: "6000000.00",
        },
      })
    ).id;

    await createFlow("INCOME", "3000000.00", daysAgo(60));
    await createFlow("EXPENSE", "1500000.00", daysAgo(59));
    await createFlow("INCOME", "3000000.00", daysAgo(31));
    await createFlow("EXPENSE", "1500000.00", daysAgo(30));
    await createFlow("INCOME", "3000000.00", daysAgo(1));
    await createFlow("EXPENSE", "1000000.00", daysAgo(1));
  }, 60_000);

  it("expone una fórmula versionada, trazable y reproducible", async () => {
    const first = await request(app).get(base()).set(auth(actor.access));
    const second = await request(app).get(base()).set(auth(actor.access));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.version).toBe("financial-health-v1");
    expect(second.body.data.version).toBe(first.body.data.version);
    expect(second.body.data.score).toBe(first.body.data.score);
    expect(second.body.data.dimensions).toEqual(first.body.data.dimensions);
    expect(first.body.data.availableDimensions).toBeGreaterThanOrEqual(3);
    expect(first.body.data.coverage).toBeGreaterThanOrEqual(60);
    expect(first.body.data.trace.liquidAvailable).toBe("6000000.00");
    expect(first.body.data.methodology.disclaimer).toContain("No es un score crediticio");

    const ids = first.body.data.dimensions.map((dimension: { id: string }) => dimension.id);
    expect(ids).toEqual([
      "LIQUIDITY",
      "DEBT",
      "SPENDING_CONTROL",
      "SAVINGS",
      "PAYMENT_COMPLIANCE",
    ]);
  });

  it("mantiene un solo snapshot por periodo y versión", async () => {
    expect(
      await prisma.aiInsight.count({
        where: {
          workspaceId: actor.workspaceId,
          type: "RECOMMENDATION",
          modelVersion: "financial-health-v1",
        },
      }),
    ).toBe(1);

    const history = await request(app).get(`${base()}/history?limit=12`).set(auth(actor.access));
    expect(history.status).toBe(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.hasEnoughHistory).toBe(false);
    expect(history.body.data.minimumPeriods).toBe(2);
  });

  it("valida los límites del histórico", async () => {
    const response = await request(app).get(`${base()}/history?limit=1`).set(auth(actor.access));
    expect(response.status).toBe(400);
  });

  it("mantiene permisos y aislamiento por workspace", async () => {
    const response = await request(app).get(base()).set(auth(outsider.access));
    expect(response.status).toBe(404);
  });
});
