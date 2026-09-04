import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Recurring secure password 1!";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const actor = { id: "", workspaceId: "", access: "" };
const outsider = { id: "", workspaceId: "", access: "" };
let accountId = "";
let categoryId = "";
let netflixSuggestionId = "";
let spotifySuggestionId = "";

const base = () => `/api/v1/workspaces/${actor.workspaceId}/recurring-detection`;

const monthDate = (monthsAgo: number) => {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(10);
  date.setUTCMonth(date.getUTCMonth() - monthsAgo);
  return date;
};

async function createPattern(merchantName: string, amount: string) {
  for (const monthsAgo of [3, 2, 1, 0]) {
    await prisma.transaction.create({
      data: {
        workspaceId: actor.workspaceId,
        type: "EXPENSE",
        amount,
        accountId,
        categoryId,
        occurredAt: monthDate(monthsAgo),
        description: `${merchantName} mensual`,
        merchantName,
        createdBy: actor.id,
      },
    });
  }
}

describe.sequential("detección automática de pagos recurrentes · flujo backend", () => {
  afterAll(async () => {
    const workspaceIds = [actor.workspaceId, outsider.workspaceId].filter(Boolean);
    const userIds = [actor.id, outsider.id].filter(Boolean);
    if (workspaceIds.length) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("prepara usuario, workspace y movimientos reales repetitivos", async () => {
    const registered = await registerVerified({
      email: `recurring-owner-${suffix}@example.com`,
      password,
      firstName: "Recurring",
    });
    actor.id = registered.user.id;
    actor.workspaceId = registered.workspace.id;
    actor.access = registered.login.body.data.tokens.accessToken;

    const other = await registerVerified({
      email: `recurring-other-${suffix}@example.com`,
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
          name: "Cuenta detección QA",
          type: "CHECKING",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "1000000.00",
          currentBalance: "1000000.00",
        },
      })
    ).id;
    categoryId = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "EXPENSE" } })
    ).id;

    await createPattern("Netflix", "26900.00");
    await createPattern("Spotify", "19900.00");
  }, 60_000);

  it("detecta y persiste sugerencias sin duplicarlas al volver a ejecutar", async () => {
    const first = await request(app).get(`${base()}/suggestions?months=12`).set(auth(actor.access));
    expect(first.status).toBe(200);
    expect(first.body.data.analyzedTransactions).toBeGreaterThanOrEqual(8);
    expect(first.body.data.suggestions.length).toBeGreaterThanOrEqual(2);

    const netflix = first.body.data.suggestions.find(
      (item: { candidate: { normalizedLabel: string } }) => item.candidate.normalizedLabel === "netflix",
    );
    const spotify = first.body.data.suggestions.find(
      (item: { candidate: { normalizedLabel: string } }) => item.candidate.normalizedLabel === "spotify",
    );
    expect(netflix.candidate).toMatchObject({ frequency: "MONTHLY", evidenceCount: 4 });
    expect(spotify.candidate).toMatchObject({ frequency: "MONTHLY", evidenceCount: 4 });
    netflixSuggestionId = netflix.id;
    spotifySuggestionId = spotify.id;

    const second = await request(app).post(`${base()}/run`).set(auth(actor.access)).send({ months: 12 });
    expect(second.status).toBe(200);
    const netflixAgain = second.body.data.suggestions.find(
      (item: { candidate: { normalizedLabel: string } }) => item.candidate.normalizedLabel === "netflix",
    );
    expect(netflixAgain.id).toBe(netflixSuggestionId);
    expect(
      await prisma.aiInsight.count({
        where: {
          workspaceId: actor.workspaceId,
          type: "SPENDING_PATTERN",
          modelVersion: "recurring-detection-v1",
        },
      }),
    ).toBe(2);
  });

  it("descartar persiste el rechazo y evita insistencia inmediata", async () => {
    const dismissed = await request(app)
      .post(`${base()}/suggestions/${netflixSuggestionId}/dismiss`)
      .set(auth(actor.access));
    expect(dismissed.status).toBe(200);
    expect(new Date(dismissed.body.data.dismissedUntil).getTime()).toBeGreaterThan(Date.now());

    const refreshed = await request(app).get(`${base()}/suggestions`).set(auth(actor.access));
    expect(
      refreshed.body.data.suggestions.some(
        (item: { candidate: { normalizedLabel: string } }) => item.candidate.normalizedLabel === "netflix",
      ),
    ).toBe(false);
    const stored = await prisma.aiInsight.findUniqueOrThrow({ where: { id: netflixSuggestionId } });
    expect(stored.isDismissed).toBe(true);
    expect(stored.validUntil).not.toBeNull();
  });

  it("confirma con correcciones y reutiliza el módulo real de obligaciones", async () => {
    const confirmed = await request(app)
      .post(`${base()}/suggestions/${spotifySuggestionId}/confirm`)
      .set(auth(actor.access))
      .send({
        name: "Spotify Premium",
        expectedAmount: "21000.00",
        amountType: "FIXED",
        frequency: "MONTHLY",
        paymentAccountId: accountId,
        categoryId,
        remindersEnabled: true,
      });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.obligation).toMatchObject({
      name: "Spotify Premium",
      expectedAmount: "21000.00",
      paymentAccountId: accountId,
      categoryId,
    });

    const obligationId = confirmed.body.data.obligation.id;
    const obligation = await prisma.recurringObligation.findUniqueOrThrow({
      where: { id: obligationId },
      include: { recurrenceRules: true, occurrences: true },
    });
    expect(obligation.recurrenceRules.frequency).toBe("MONTHLY");
    expect(obligation.recurrenceRules.intervalValue).toBe(1);
    expect(obligation.occurrences).toHaveLength(1);
    expect(
      await prisma.financialEvent.count({
        where: { workspaceId: actor.workspaceId, relatedObligationId: obligationId },
      }),
    ).toBe(1);

    const stored = await prisma.aiInsight.findUniqueOrThrow({ where: { id: spotifySuggestionId } });
    expect((stored.data as { state?: string }).state).toBe("CONFIRMED");
    expect(stored.isRead).toBe(true);
  });

  it("no vuelve a sugerir una recurrencia ya configurada ni permite confirmarla dos veces", async () => {
    const refreshed = await request(app).get(`${base()}/suggestions`).set(auth(actor.access));
    expect(
      refreshed.body.data.suggestions.some(
        (item: { candidate: { normalizedLabel: string } }) => item.candidate.normalizedLabel === "spotify",
      ),
    ).toBe(false);

    const repeated = await request(app)
      .post(`${base()}/suggestions/${spotifySuggestionId}/confirm`)
      .set(auth(actor.access))
      .send({});
    expect(repeated.status).toBe(409);
    expect(
      await prisma.recurringObligation.count({
        where: { workspaceId: actor.workspaceId, name: "Spotify Premium", deletedAt: null },
      }),
    ).toBe(1);
  });

  it("mantiene aislamiento por workspace", async () => {
    const response = await request(app)
      .post(`/api/v1/workspaces/${actor.workspaceId}/recurring-detection/suggestions/${netflixSuggestionId}/dismiss`)
      .set(auth(outsider.access));
    expect(response.status).toBe(404);
  });
});
