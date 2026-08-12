import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Phase eight secure password 1!";
const actors = ["owner", "other"].map((label) => ({
  email: `phase8-${label}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
}));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const endpoint = (report: string, workspaceId = actors[0]!.workspaceId) =>
  `/api/v1/workspaces/${workspaceId}/reports/${report}`;
const custom = "period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31";
const accountIds: string[] = [];
let expenseGlobal = "";
let incomeGlobal = "";
let customCategory = "";
let foreignCategory = "";

describe.sequential("Fase 8 reportes básicos reales", () => {
  afterAll(async () => {
    const workspaceIds = actors.map((actor) => actor.workspaceId).filter(Boolean);
    const userIds = actors.map((actor) => actor.id).filter(Boolean);
    if (workspaceIds.length) {
      await prisma.transaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.budget.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.category.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.financialAccount.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    }
    await prisma.rolePermission.deleteMany({
      where: { role: { code: { startsWith: "PHASE8_" } } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: "PHASE8_" } } });
    if (userIds.length) {
      await prisma.workspace.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("prepara dos workspaces y devuelve reportes vacíos", async () => {
    for (const actor of actors) {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: actor.email, password, firstName: "Phase8", acceptedTerms: true });
      expect(response.status).toBe(201);
      actor.id = response.body.data.user.id;
      await prisma.user.update({ where: { id: actor.id }, data: { isEmailVerified: true } });
      const login = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password });
      actor.access = login.body.data.tokens.accessToken;
      actor.workspaceId = (
        await prisma.workspace.findFirstOrThrow({ where: { ownerUserId: actor.id } })
      ).id;
    }
    const empty = await request(app)
      .get(`${endpoint("income-vs-expenses", actors[1]!.workspaceId)}?currency=COP`)
      .set(auth(actors[1]!.access));
    expect(empty.status).toBe(200);
    expect(empty.body.data.summariesByCurrency[0]).toMatchObject({
      currency: "COP",
      totalIncome: "0.00",
      totalExpenses: "0.00",
      averageIncome: "0.00",
      averageExpense: "0.00",
    });
  }, 60_000);

  it("prepara cuentas, categorías y movimientos representativos", async () => {
    const makeAccount = async (
      workspaceId: string,
      name: string,
      currentBalance: string,
      options: {
        currency?: string;
        nature?: "ASSET" | "LIABILITY";
        type?: "SAVINGS" | "CREDIT_CARD";
        includeInNetWorth?: boolean;
        isActive?: boolean;
        isFavorite?: boolean;
      } = {},
    ) =>
      (
        await prisma.financialAccount.create({
          data: {
            workspaceId,
            name,
            type: options.type ?? "SAVINGS",
            nature: options.nature ?? "ASSET",
            currency: options.currency ?? "COP",
            openingBalance: currentBalance,
            currentBalance,
            includeInNetWorth: options.includeInNetWorth ?? true,
            isActive: options.isActive ?? true,
            isFavorite: options.isFavorite ?? false,
          },
        })
      ).id;
    accountIds.push(
      await makeAccount(actors[0]!.workspaceId, "Ahorros favoritos", "1000", {
        isFavorite: true,
      }),
      await makeAccount(actors[0]!.workspaceId, "Tarjeta", "-300", {
        nature: "LIABILITY",
        type: "CREDIT_CARD",
      }),
      await makeAccount(actors[0]!.workspaceId, "Excluida", "500", {
        includeInNetWorth: false,
      }),
      await makeAccount(actors[0]!.workspaceId, "Archivada", "999", { isActive: false }),
      await makeAccount(actors[0]!.workspaceId, "Dólares", "50", { currency: "USD" }),
      await makeAccount(actors[1]!.workspaceId, "Ajena", "777"),
    );
    expenseGlobal = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "EXPENSE" } })
    ).id;
    incomeGlobal = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "INCOME" } })
    ).id;
    customCategory = (
      await prisma.category.create({
        data: {
          workspaceId: actors[0]!.workspaceId,
          name: `Archivada ${suffix.slice(0, 6)}`,
          type: "EXPENSE",
          icon: "archive",
          color: "#112233",
          isActive: false,
          deletedAt: new Date("2026-08-20T00:00:00Z"),
        },
      })
    ).id;
    foreignCategory = (
      await prisma.category.create({
        data: {
          workspaceId: actors[1]!.workspaceId,
          name: `Privada ${suffix.slice(0, 6)}`,
          type: "EXPENSE",
        },
      })
    ).id;
    const createMovement = async (input: {
      type: "INCOME" | "EXPENSE" | "TRANSFER" | "INVESTMENT";
      amount: string;
      occurredAt: string;
      categoryId?: string;
      accountId?: string;
      currency?: string;
      status?: "CONFIRMED" | "CANCELLED";
      deletedAt?: Date;
      other?: boolean;
    }) => {
      const actor = input.other ? actors[1]! : actors[0]!;
      return prisma.transaction.create({
        data: {
          workspaceId: actor.workspaceId,
          createdBy: actor.id,
          type: input.type,
          status: input.status ?? "CONFIRMED",
          amount: input.amount,
          currency: input.currency ?? "COP",
          accountId: input.accountId ?? (input.other ? accountIds[5]! : accountIds[0]!),
          ...(input.type === "TRANSFER" ? { destinationAccountId: accountIds[2]! } : {}),
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          occurredAt: new Date(input.occurredAt),
          ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
          description: `Phase8 ${input.type}`,
        },
      });
    };
    await createMovement({
      type: "INCOME",
      amount: "600",
      occurredAt: "2026-08-02T12:00:00Z",
      categoryId: incomeGlobal,
    });
    await createMovement({
      type: "INCOME",
      amount: "200",
      occurredAt: "2026-08-03T12:00:00Z",
      categoryId: incomeGlobal,
    });
    await createMovement({
      type: "EXPENSE",
      amount: "100",
      occurredAt: "2026-08-04T12:00:00Z",
      categoryId: expenseGlobal,
    });
    await createMovement({
      type: "EXPENSE",
      amount: "300",
      occurredAt: "2026-08-10T12:00:00Z",
      categoryId: customCategory,
      accountId: accountIds[2]!,
    });
    await createMovement({
      type: "INCOME",
      amount: "20",
      occurredAt: "2026-08-05T12:00:00Z",
      categoryId: incomeGlobal,
      currency: "USD",
      accountId: accountIds[4]!,
    });
    await createMovement({
      type: "EXPENSE",
      amount: "5",
      occurredAt: "2026-08-06T12:00:00Z",
      categoryId: expenseGlobal,
      currency: "USD",
      accountId: accountIds[4]!,
    });
    await createMovement({ type: "TRANSFER", amount: "900", occurredAt: "2026-08-07T12:00:00Z" });
    await createMovement({
      type: "EXPENSE",
      amount: "999",
      occurredAt: "2026-08-08T12:00:00Z",
      status: "CANCELLED",
      categoryId: expenseGlobal,
    });
    await createMovement({
      type: "EXPENSE",
      amount: "999",
      occurredAt: "2026-08-09T12:00:00Z",
      deletedAt: new Date("2026-08-09T13:00:00Z"),
      categoryId: expenseGlobal,
    });
    await createMovement({ type: "INVESTMENT", amount: "999", occurredAt: "2026-08-11T12:00:00Z" });
    await createMovement({
      type: "EXPENSE",
      amount: "50",
      occurredAt: "2026-07-15T12:00:00Z",
      categoryId: expenseGlobal,
    });
    await createMovement({
      type: "INCOME",
      amount: "9999",
      occurredAt: "2026-08-12T12:00:00Z",
      categoryId: incomeGlobal,
      other: true,
    });
  }, 60_000);

  it("calcula ingresos, gastos, promedios, comparación y monedas separadas", async () => {
    const response = await request(app)
      .get(`${endpoint("income-vs-expenses")}?${custom}`)
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    const cop = response.body.data.summariesByCurrency.find(
      (row: { currency: string }) => row.currency === "COP",
    );
    expect(cop).toMatchObject({
      totalIncome: "800.00",
      totalExpenses: "400.00",
      netCashFlow: "400.00",
      incomeTransactionCount: 2,
      expenseTransactionCount: 2,
      averageIncome: "400.00",
      averageExpense: "200.00",
      comparisonWithPreviousPeriod: {
        previousExpenses: "50.00",
        incomeChangePercentage: null,
        expenseChangePercentage: "700.00",
      },
    });
    expect(response.body.data.summariesByCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "COP" }),
        expect.objectContaining({ currency: "USD", netCashFlow: "15.00" }),
      ]),
    );
  }, 30_000);

  it("combina currency, accountId y categoryId mediante AND", async () => {
    const yes = await request(app)
      .get(
        `${endpoint("income-vs-expenses")}?${custom}&currency=COP&accountId=${accountIds[2]}&categoryId=${customCategory}`,
      )
      .set(auth(actors[0]!.access));
    expect(yes.status).toBe(200);
    expect(yes.body.data.summariesByCurrency[0]).toMatchObject({ totalExpenses: "300.00" });
    const no = await request(app)
      .get(
        `${endpoint("income-vs-expenses")}?${custom}&currency=USD&accountId=${accountIds[2]}&categoryId=${customCategory}`,
      )
      .set(auth(actors[0]!.access));
    expect(no.body.data.summariesByCurrency[0].totalExpenses).toBe("0.00");
  }, 30_000);

  it("agrupa gastos globales, archivados y sin categoría con orden y porcentajes", async () => {
    const response = await request(app)
      .get(`${endpoint("expenses-by-category")}?${custom}`)
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    const cop = response.body.data.groupsByCurrency.find(
      (group: { currency: string }) => group.currency === "COP",
    );
    expect(cop.totalExpenses).toBe("400.00");
    expect(cop.categories).toEqual([
      expect.objectContaining({
        categoryId: customCategory,
        amount: "300.00",
        percentage: "75.00",
        icon: "archive",
      }),
      expect.objectContaining({ categoryId: expenseGlobal, amount: "100.00", percentage: "25.00" }),
    ]);
    const foreign = await request(app)
      .get(`${endpoint("expenses-by-category")}?${custom}&categoryId=${foreignCategory}`)
      .set(auth(actors[0]!.access));
    expect(foreign.status).toBe(404);
  }, 30_000);

  it("genera flujo diario, semanal y mensual incluyendo buckets vacíos", async () => {
    const daily = await request(app)
      .get(
        `${endpoint("cash-flow")}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-12&groupBy=DAY&currency=COP`,
      )
      .set(auth(actors[0]!.access));
    expect(daily.status).toBe(200);
    expect(daily.body.data.seriesByCurrency[0].points).toHaveLength(12);
    expect(
      daily.body.data.seriesByCurrency[0].points.some(
        (point: { totalIncome: string; totalExpenses: string }) =>
          point.totalIncome === "0.00" && point.totalExpenses === "0.00",
      ),
    ).toBe(true);
    for (const groupBy of ["WEEK", "MONTH"]) {
      const query =
        groupBy === "WEEK"
          ? `${custom}&groupBy=WEEK`
          : "period=CURRENT_YEAR&groupBy=MONTH&currency=COP";
      const response = await request(app)
        .get(`${endpoint("cash-flow")}?${query}`)
        .set(auth(actors[0]!.access));
      expect(response.status).toBe(200);
      expect(response.body.data.groupBy).toBe(groupBy);
    }
  }, 30_000);

  it("lista saldos actuales, resume solo activas y pagina con orden estable", async () => {
    const active = await request(app)
      .get(`${endpoint("account-balances")}?currency=COP&limit=2`)
      .set(auth(actors[0]!.access));
    expect(active.status).toBe(200);
    expect(active.body.data.pagination).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(active.body.data.accounts[0].id).toBe(accountIds[0]);
    expect(active.body.data.summariesByCurrency[0]).toMatchObject({
      assetBalance: "1500.00",
      liabilityBalance: "300.00",
      netWorth: "700.00",
      availableMoney: "1500.00",
      accountCount: 3,
    });
    const archived = await request(app)
      .get(`${endpoint("account-balances")}?includeArchived=true&search=Archivada`)
      .set(auth(actors[0]!.access));
    expect(archived.status).toBe(200);
    expect(archived.body.data.accounts).toEqual([
      expect.objectContaining({ id: accountIds[3], isActive: false, currentBalance: "999.00" }),
    ]);
    expect(archived.body.data.summariesByCurrency).toEqual([]);
  }, 30_000);

  it("rechaza consultas inválidas, sesión ausente, IDOR y falta de permiso", async () => {
    expect(
      (
        await request(app)
          .get(`${endpoint("cash-flow")}?period=LAST_7_DAYS&groupBy=WEEK`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`${endpoint("income-vs-expenses")}?unknown=true`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(400);
    expect((await request(app).get(endpoint("account-balances"))).status).toBe(401);
    expect(
      (await request(app).get(endpoint("account-balances")).set(auth(actors[1]!.access))).status,
    ).toBe(404);
    const denied = await prisma.role.create({
      data: { code: `PHASE8_DENIED_${suffix.slice(0, 12)}`, name: "Phase8 denied" },
    });
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: actors[0]!.workspaceId,
          userId: actors[0]!.id,
        },
      },
      data: { roleId: denied.id },
    });
    expect(
      (await request(app).get(endpoint("account-balances")).set(auth(actors[0]!.access))).status,
    ).toBe(403);
    const owner = await prisma.role.findUniqueOrThrow({ where: { code: "OWNER" } });
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: actors[0]!.workspaceId,
          userId: actors[0]!.id,
        },
      },
      data: { roleId: owner.id },
    });
  }, 30_000);

  it("demuestra solo lectura sin snapshots, auditoría, outbox ni mutaciones", async () => {
    const before = {
      transactions: await prisma.transaction.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, version: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      accounts: await prisma.financialAccount.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, currentBalance: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      categories: await prisma.category.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      snapshots: await prisma.accountBalanceSnapshot.count(),
      audits: await prisma.auditLog.count(),
      outbox: await prisma.outboxEvent.count(),
    };
    for (const report of [
      `income-vs-expenses?${custom}`,
      `expenses-by-category?${custom}`,
      `cash-flow?${custom}&groupBy=WEEK`,
      "account-balances",
    ]) {
      expect((await request(app).get(endpoint(report)).set(auth(actors[0]!.access))).status).toBe(
        200,
      );
    }
    expect(
      await prisma.transaction.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, version: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.transactions);
    expect(
      await prisma.financialAccount.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, currentBalance: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.accounts);
    expect(
      await prisma.category.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.categories);
    expect(await prisma.accountBalanceSnapshot.count()).toBe(before.snapshots);
    expect(await prisma.auditLog.count()).toBe(before.audits);
    expect(await prisma.outboxEvent.count()).toBe(before.outbox);
  }, 30_000);
});
