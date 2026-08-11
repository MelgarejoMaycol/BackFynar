import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
const suffix = randomUUID().replaceAll("-", "");
const password = "Phase seven secure password 1!";
const actors = ["owner", "other"].map((label) => ({
  email: `phase7-${label}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
}));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = () => `/api/v1/workspaces/${actors[0]!.workspaceId}/budgets`;
const accounts: string[] = [];
let expenseGlobal = "",
  incomeGlobal = "",
  custom = "",
  archivedCategory = "",
  otherCategory = "";
const budgets: Record<string, string> = {};
const payload = (overrides: Record<string, unknown> = {}) => ({
  name: "General agosto",
  period: "MONTHLY",
  startsOn: "2026-08-01",
  endsOn: "2026-08-31",
  amount: "500.00",
  currency: "COP",
  alertThreshold: "80.00",
  ...overrides,
});
describe.sequential("Fase 7 presupuestos reales", () => {
  afterAll(async () => {
    const ws = actors.map((a) => a.workspaceId).filter(Boolean),
      users = actors.map((a) => a.id).filter(Boolean);
    if (ws.length) {
      await prisma.transaction.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.budget.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.category.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.financialAccount.deleteMany({ where: { workspaceId: { in: ws } } });
    }
    const owner = await prisma.role.findUnique({ where: { code: "OWNER" } });
    if (owner && actors[0]!.workspaceId && actors[0]!.id)
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id },
        data: { roleId: owner.id },
      });
    await prisma.rolePermission.deleteMany({
      where: { role: { code: { startsWith: "PHASE7_" } } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: "PHASE7_" } } });
    if (users.length) {
      await prisma.workspace.deleteMany({ where: { ownerUserId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    await prisma.$disconnect();
  });
  it("prepara workspaces, cuentas y categorías", async () => {
    for (const actor of actors) {
      const r = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: actor.email, password, firstName: "Phase7" });
      expect(r.status).toBe(201);
      actor.id = r.body.data.user.id;
      actor.access = r.body.data.tokens.accessToken;
      actor.workspaceId = (
        await prisma.workspace.findFirstOrThrow({ where: { ownerUserId: actor.id } })
      ).id;
    }
    const make = async (workspaceId: string, name: string, currency = "COP", isActive = true) =>
      (
        await prisma.financialAccount.create({
          data: {
            workspaceId,
            name,
            type: "SAVINGS",
            nature: "ASSET",
            currency,
            openingBalance: "1000",
            currentBalance: "1000",
            isActive,
          },
        })
      ).id;
    accounts.push(
      await make(actors[0]!.workspaceId, "COP uno"),
      await make(actors[0]!.workspaceId, "COP dos"),
      await make(actors[0]!.workspaceId, "USD", "USD"),
      await make(actors[0]!.workspaceId, "Archivada", "COP", false),
      await make(actors[1]!.workspaceId, "Ajena"),
    );
    expenseGlobal = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "EXPENSE" } })
    ).id;
    incomeGlobal = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "INCOME" } })
    ).id;
    custom = (
      await prisma.category.create({
        data: {
          workspaceId: actors[0]!.workspaceId,
          name: `Custom ${suffix.slice(0, 8)}`,
          type: "EXPENSE",
          isSystem: false,
        },
      })
    ).id;
    archivedCategory = (
      await prisma.category.create({
        data: {
          workspaceId: actors[0]!.workspaceId,
          name: `Archived ${suffix.slice(0, 8)}`,
          type: "EXPENSE",
          isSystem: false,
          isActive: false,
          deletedAt: new Date(),
        },
      })
    ).id;
    otherCategory = (
      await prisma.category.create({
        data: {
          workspaceId: actors[1]!.workspaceId,
          name: `Other ${suffix.slice(0, 8)}`,
          type: "EXPENSE",
          isSystem: false,
        },
      })
    ).id;
  }, 60_000);
  it("crea presupuestos generales, asociados, superpuestos y multimoneda", async () => {
    const cases = [
      ["general", payload()],
      [
        "category",
        payload({
          name: "Categoría",
          amount: "100.00",
          alertThreshold: "80",
          categoryIds: [custom],
        }),
      ],
      [
        "account",
        payload({ name: "Cuenta", amount: "200", alertThreshold: "50", accountIds: [accounts[0]] }),
      ],
      ["both", payload({ name: "Ambos", categoryIds: [custom], accountIds: [accounts[0]] })],
      [
        "multi",
        payload({
          name: "Múltiples",
          categoryIds: [custom, expenseGlobal],
          accountIds: [accounts[0], accounts[1]],
        }),
      ],
      ["usd", payload({ name: "USD", currency: "usd", amount: "100", accountIds: [accounts[2]] })],
      ["overlap", payload({ name: "Superpuesto", categoryIds: [custom] })],
    ] as const;
    for (const [key, body] of cases) {
      const r = await request(app).post(base()).set(auth(actors[0]!.access)).send(body);
      expect(r.status).toBe(201);
      expect(r.body.data.currency).toBe(key === "usd" ? "USD" : "COP");
      budgets[key] = r.body.data.id;
    }
    expect(await prisma.budget.count({ where: { workspaceId: actors[0]!.workspaceId } })).toBe(7);
  }, 60_000);
  it("rechaza asociaciones y payloads inválidos con rollback total", async () => {
    const before = await prisma.budget.count({ where: { workspaceId: actors[0]!.workspaceId } });
    const invalid = [
      payload({ name: "Ingreso", categoryIds: [incomeGlobal] }),
      payload({ name: "Archivada", categoryIds: [archivedCategory] }),
      payload({ name: "Ajena", categoryIds: [otherCategory] }),
      payload({ name: "Cuenta archivada", accountIds: [accounts[3]] }),
      payload({ name: "Cuenta ajena", accountIds: [accounts[4]] }),
      payload({ name: "Moneda", accountIds: [accounts[2]] }),
      payload({ name: "Duplicada", categoryIds: [custom, custom] }),
      payload({ amount: "0" }),
      payload({ alertThreshold: "101" }),
      payload({ startsOn: "2026-08-02" }),
      payload({ workspaceId: actors[0]!.workspaceId }),
      payload({ spent: "1" }),
    ];
    for (const body of invalid) {
      const r = await request(app).post(base()).set(auth(actors[0]!.access)).send(body);
      expect([400, 404]).toContain(r.status);
    }
    expect(await prisma.budget.count({ where: { workspaceId: actors[0]!.workspaceId } })).toBe(
      before,
    );
    expect(
      await prisma.budgetCategory.count({
        where: { budgets: { workspaceId: actors[0]!.workspaceId } },
      }),
    ).toBe(5);
  }, 60_000);
  it("deriva gasto con moneda, periodo y semántica AND", async () => {
    const create = async (data: {
      type: "EXPENSE" | "INCOME" | "TRANSFER" | "INVESTMENT";
      amount: string;
      currency?: string;
      accountId?: string;
      categoryId: string;
      occurredAt: string;
      status?: "CONFIRMED" | "CANCELLED";
      workspaceId?: string;
    }) =>
      prisma.transaction.create({
        data: {
          workspaceId: data.workspaceId ?? actors[0]!.workspaceId,
          createdBy:
            (data.workspaceId ?? actors[0]!.workspaceId) === actors[0]!.workspaceId
              ? actors[0]!.id
              : actors[1]!.id,
          type: data.type,
          status: data.status ?? "CONFIRMED",
          amount: data.amount,
          currency: data.currency ?? "COP",
          accountId: data.accountId ?? accounts[0]!,
          destinationAccountId: data.type === "TRANSFER" ? accounts[1]! : null,
          categoryId: data.categoryId,
          occurredAt: new Date(data.occurredAt),
          ...(data.status === "CANCELLED" ? { deletedAt: new Date() } : {}),
        },
      });
    await create({
      type: "EXPENSE",
      amount: "100",
      accountId: accounts[0]!,
      categoryId: custom,
      occurredAt: "2026-08-02T12:00:00Z",
    });
    await create({
      type: "EXPENSE",
      amount: "50",
      accountId: accounts[0]!,
      categoryId: expenseGlobal,
      occurredAt: "2026-08-03T12:00:00Z",
    });
    await create({
      type: "EXPENSE",
      amount: "30",
      accountId: accounts[1]!,
      categoryId: custom,
      occurredAt: "2026-08-04T12:00:00Z",
    });
    await create({
      type: "EXPENSE",
      amount: "25",
      currency: "USD",
      accountId: accounts[2]!,
      categoryId: custom,
      occurredAt: "2026-08-02T12:00:00Z",
    });
    await create({
      type: "EXPENSE",
      amount: "999",
      categoryId: custom,
      occurredAt: "2026-07-01T12:00:00Z",
    });
    await create({
      type: "EXPENSE",
      amount: "999",
      categoryId: custom,
      occurredAt: "2026-08-02T12:00:00Z",
      status: "CANCELLED",
    });
    await create({
      type: "INCOME",
      amount: "999",
      categoryId: incomeGlobal,
      occurredAt: "2026-08-02T12:00:00Z",
    });
    await create({
      type: "TRANSFER",
      amount: "999",
      categoryId: expenseGlobal,
      occurredAt: "2026-08-02T12:00:00Z",
    });
    await create({
      type: "INVESTMENT",
      amount: "999",
      categoryId: expenseGlobal,
      occurredAt: "2026-08-02T12:00:00Z",
    });
    await create({
      type: "EXPENSE",
      amount: "999",
      accountId: accounts[4]!,
      categoryId: otherCategory,
      occurredAt: "2026-08-02T12:00:00Z",
      workspaceId: actors[1]!.workspaceId,
    });
    const list = await request(app).get(`${base()}?limit=100`).set(auth(actors[0]!.access));
    expect(list.status).toBe(200);
    const byName = new Map(
      list.body.data.items.map((b: { name: string; progress: { spent: string } }) => [
        b.name,
        b.progress.spent,
      ]),
    );
    expect(byName.get("General agosto")).toBe("180.00");
    expect(byName.get("Categoría")).toBe("130.00");
    expect(byName.get("Cuenta")).toBe("150.00");
    expect(byName.get("Ambos")).toBe("100.00");
    expect(byName.get("USD")).toBe("25.00");
    expect(byName.get("Superpuesto")).toBe("130.00");
  }, 60_000);
  it("incluye el progreso de presupuestos activos en el dashboard", async () => {
    const response = await request(app)
      .get(
        `/api/v1/workspaces/${actors[0]!.workspaceId}/dashboard?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31`,
      )
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    expect(response.body.data.budgetProgress).toHaveLength(7);
    expect(
      response.body.data.budgetProgress.find(
        (budget: { id: string }) => budget.id === budgets.category,
      ),
    ).toMatchObject({
      currency: "COP",
      progress: { spent: "130.00", percentage: "130.00", status: "EXCEEDED" },
    });
  }, 30_000);
  it("calcula estados, proyección y refleja ediciones/cancelaciones", async () => {
    const readOnlySnapshot = {
      budgets: await prisma.budget.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      transactions: await prisma.transaction.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true, amount: true, status: true },
        orderBy: { id: "asc" },
      }),
    };
    const category = await request(app)
      .get(`${base()}/${budgets.category}`)
      .set(auth(actors[0]!.access));
    expect(category.body.data.progress).toMatchObject({
      spent: "130.00",
      remaining: "-30.00",
      percentage: "130.00",
      status: "EXCEEDED",
    });
    const account = await request(app)
      .get(`${base()}/${budgets.account}`)
      .set(auth(actors[0]!.access));
    expect(account.body.data.progress.status).toBe("WARNING");
    expect(
      new Prisma.Decimal(account.body.data.projection.projectedSpend).gt(
        account.body.data.progress.spent,
      ),
    ).toBe(true);
    expect(
      await prisma.budget.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(readOnlySnapshot.budgets);
    expect(
      await prisma.transaction.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true, amount: true, status: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(readOnlySnapshot.transactions);
    const movement = await prisma.transaction.findFirstOrThrow({
      where: { workspaceId: actors[0]!.workspaceId, type: "EXPENSE", amount: "100" },
    });
    await prisma.transaction.update({ where: { id: movement.id }, data: { amount: "120" } });
    expect(
      (await request(app).get(`${base()}/${budgets.both}`).set(auth(actors[0]!.access))).body.data
        .progress.spent,
    ).toBe("120.00");
    await prisma.transaction.update({
      where: { id: movement.id },
      data: { status: "CANCELLED", deletedAt: new Date() },
    });
    expect(
      (await request(app).get(`${base()}/${budgets.both}`).set(auth(actors[0]!.access))).body.data
        .progress.spent,
    ).toBe("0.00");
  }, 30_000);
  it("mantiene asociaciones históricas archivadas", async () => {
    await prisma.category.update({
      where: { id: custom },
      data: { isActive: false, deletedAt: new Date() },
    });
    await prisma.financialAccount.update({
      where: { id: accounts[0]! },
      data: { isActive: false },
    });
    const detail = await request(app)
      .get(`${base()}/${budgets.category}`)
      .set(auth(actors[0]!.access));
    expect(detail.status).toBe(200);
    expect(detail.body.data.categories[0]).toMatchObject({ id: custom, isActive: false });
    await prisma.category.update({
      where: { id: custom },
      data: { isActive: true, deletedAt: null },
    });
    await prisma.financialAccount.update({ where: { id: accounts[0]! }, data: { isActive: true } });
  }, 30_000);
  it("edita definición, asociaciones y moneda atómicamente", async () => {
    const changed = await request(app)
      .patch(`${base()}/${budgets.both}`)
      .set(auth(actors[0]!.access))
      .send({
        name: "Ambos editado",
        amount: "600",
        period: "WEEKLY",
        startsOn: "2026-08-01",
        endsOn: "2026-08-07",
        categoryIds: [expenseGlobal],
        accountIds: [accounts[1]],
        rolloverEnabled: true,
      });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({
      name: "Ambos editado",
      amount: "600.00",
      period: "WEEKLY",
      rolloverEnabled: true,
    });
    const compatible = await request(app)
      .patch(`${base()}/${budgets.usd}`)
      .set(auth(actors[0]!.access))
      .send({ currency: "cop", accountIds: [accounts[1]] });
    expect(compatible.status).toBe(200);
    expect(compatible.body.data.currency).toBe("COP");
    const snapshot = await prisma.budget.findUniqueOrThrow({
      where: { id: budgets.usd! },
      include: { budgetAccounts: true },
    });
    const incompatible = await request(app)
      .patch(`${base()}/${budgets.usd}`)
      .set(auth(actors[0]!.access))
      .send({ currency: "USD" });
    expect(incompatible.status).toBe(404);
    expect(
      await prisma.budget.findUniqueOrThrow({
        where: { id: budgets.usd! },
        include: { budgetAccounts: true },
      }),
    ).toEqual(snapshot);
  }, 30_000);
  it("filtra y pagina con orden determinista e AND", async () => {
    const filtered = await request(app)
      .get(
        `${base()}?currency=COP&categoryId=${custom}&accountId=${accounts[0]}&search=Superpuesto&page=1&limit=1`,
      )
      .set(auth(actors[0]!.access));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toMatchObject({ page: 1, limit: 1, total: 0 });
    const both = await request(app)
      .get(`${base()}?categoryId=${custom}&accountId=${accounts[0]}&limit=100`)
      .set(auth(actors[0]!.access));
    expect(both.body.data.items.map((b: { id: string }) => b.id)).toContain(budgets.multi);
    const temporal = await request(app)
      .get(`${base()}?period=MONTHLY&dateFrom=2026-08-15&dateTo=2026-08-20&limit=100`)
      .set(auth(actors[0]!.access));
    expect(temporal.status).toBe(200);
    expect(
      temporal.body.data.items.every(
        (budget: { period: string; startsOn: string; endsOn: string }) =>
          budget.period === "MONTHLY" &&
          budget.startsOn <= "2026-08-20" &&
          budget.endsOn >= "2026-08-15",
      ),
    ).toBe(true);
  }, 30_000);
  it("archiva, conserva asociaciones, excluye por defecto y restaura", async () => {
    const id = budgets.multi!;
    const before = await prisma.transaction.findMany({
      where: { workspaceId: actors[0]!.workspaceId },
      select: { id: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    expect((await request(app).delete(`${base()}/${id}`).set(auth(actors[0]!.access))).status).toBe(
      204,
    );
    expect(
      (await request(app).get(base()).set(auth(actors[0]!.access))).body.data.items.some(
        (b: { id: string }) => b.id === id,
      ),
    ).toBe(false);
    const archived = await request(app)
      .get(`${base()}?includeArchived=true&limit=100`)
      .set(auth(actors[0]!.access));
    expect(archived.body.data.items.some((b: { id: string }) => b.id === id)).toBe(true);
    expect(await prisma.budgetCategory.count({ where: { budgetId: id } })).toBe(2);
    expect(
      (await request(app).post(`${base()}/${id}/restore`).set(auth(actors[0]!.access))).status,
    ).toBe(200);
    expect(
      await prisma.transaction.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
  }, 30_000);
  it("POST calcula progreso real previo y coincide exactamente con GET", async () => {
    const workspaceId = actors[1]!.workspaceId;
    const endpoint = `/api/v1/workspaces/${workspaceId}/budgets`;
    await prisma.transaction.deleteMany({ where: { workspaceId } });
    const correctAccount = accounts[4]!;
    const secondAccount = (
      await prisma.financialAccount.create({
        data: {
          workspaceId,
          name: `Phase7 second ${suffix.slice(0, 8)}`,
          type: "SAVINGS",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "1000",
          currentBalance: "1000",
        },
      })
    ).id;
    const usdAccount = (
      await prisma.financialAccount.create({
        data: {
          workspaceId,
          name: `Phase7 USD ${suffix.slice(0, 8)}`,
          type: "SAVINGS",
          nature: "ASSET",
          currency: "USD",
          openingBalance: "1000",
          currentBalance: "1000",
        },
      })
    ).id;
    const createdMovementIds: string[] = [];
    const insert = async (data: {
      type?: "EXPENSE" | "INCOME" | "TRANSFER";
      status?: "CONFIRMED" | "CANCELLED";
      amount: string;
      currency?: string;
      accountId?: string;
      destinationAccountId?: string;
      categoryId: string;
      occurredAt: string;
      targetWorkspaceId?: string;
    }) => {
      const targetWorkspaceId = data.targetWorkspaceId ?? workspaceId;
      const row = await prisma.transaction.create({
        data: {
          workspaceId: targetWorkspaceId,
          createdBy: targetWorkspaceId === workspaceId ? actors[1]!.id : actors[0]!.id,
          type: data.type ?? "EXPENSE",
          status: data.status ?? "CONFIRMED",
          amount: data.amount,
          currency: data.currency ?? "COP",
          accountId: data.accountId ?? correctAccount,
          ...(data.destinationAccountId ? { destinationAccountId: data.destinationAccountId } : {}),
          categoryId: data.categoryId,
          occurredAt: new Date(data.occurredAt),
          ...(data.status === "CANCELLED" ? { deletedAt: new Date() } : {}),
        },
      });
      createdMovementIds.push(row.id);
    };
    const assertPostEqualsGet = async (body: Record<string, unknown>, spent: string) => {
      const post = await request(app).post(endpoint).set(auth(actors[1]!.access)).send(body);
      expect(post.status).toBe(201);
      expect(post.body.data.progress.spent).toBe(spent);
      const get = await request(app)
        .get(`${endpoint}/${post.body.data.id}`)
        .set(auth(actors[1]!.access));
      expect(get.status).toBe(200);
      expect(post.body.data.progress).toEqual(get.body.data.progress);
      expect(post.body.data.projection).toEqual(get.body.data.projection);
      return post.body.data.id as string;
    };
    const createdBudgetIds: string[] = [];
    await insert({
      amount: "100",
      categoryId: expenseGlobal,
      occurredAt: "2026-08-02T12:00:00Z",
    });
    createdBudgetIds.push(
      await assertPostEqualsGet(
        payload({ name: "POST general", amount: "500", categoryIds: [], accountIds: [] }),
        "100.00",
      ),
    );
    const generalPost = await request(app)
      .get(`${endpoint}/${createdBudgetIds[0]}`)
      .set(auth(actors[1]!.access));
    expect(generalPost.body.data.progress).toMatchObject({
      spent: "100.00",
      remaining: "400.00",
      percentage: "20.00",
    });
    await insert({ amount: "80", categoryId: otherCategory, occurredAt: "2026-08-03T12:00:00Z" });
    await insert({
      amount: "20",
      accountId: secondAccount,
      categoryId: otherCategory,
      occurredAt: "2026-08-03T13:00:00Z",
    });
    await insert({
      amount: "30",
      categoryId: expenseGlobal,
      occurredAt: "2026-08-03T14:00:00Z",
    });
    createdBudgetIds.push(
      await assertPostEqualsGet(
        payload({
          name: "POST AND",
          categoryIds: [otherCategory],
          accountIds: [correctAccount],
        }),
        "80.00",
      ),
    );
    await insert({
      amount: "25",
      currency: "USD",
      accountId: usdAccount,
      categoryId: expenseGlobal,
      occurredAt: "2026-08-04T12:00:00Z",
    });
    createdBudgetIds.push(
      await assertPostEqualsGet(
        payload({
          name: "POST USD",
          currency: "USD",
          accountIds: [usdAccount],
        }),
        "25.00",
      ),
    );
    await insert({
      amount: "900",
      status: "CANCELLED",
      categoryId: expenseGlobal,
      occurredAt: "2026-08-04T12:00:00Z",
    });
    await insert({
      type: "INCOME",
      amount: "900",
      categoryId: incomeGlobal,
      occurredAt: "2026-08-04T12:00:00Z",
    });
    await insert({
      type: "TRANSFER",
      amount: "900",
      destinationAccountId: secondAccount,
      categoryId: expenseGlobal,
      occurredAt: "2026-08-04T12:00:00Z",
    });
    await insert({
      amount: "900",
      categoryId: expenseGlobal,
      occurredAt: "2026-07-31T12:00:00Z",
    });
    await insert({
      amount: "900",
      categoryId: expenseGlobal,
      occurredAt: "2026-08-20T12:00:00Z",
    });
    await insert({
      amount: "900",
      accountId: accounts[0]!,
      categoryId: expenseGlobal,
      occurredAt: "2026-08-04T12:00:00Z",
      targetWorkspaceId: actors[0]!.workspaceId,
    });
    const beforeRead = {
      accounts: await prisma.financialAccount.findMany({
        where: { id: { in: [correctAccount, secondAccount, usdAccount] } },
        select: { id: true, currentBalance: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      movements: await prisma.transaction.findMany({
        where: { id: { in: createdMovementIds } },
        select: { id: true, amount: true, status: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    };
    createdBudgetIds.push(
      await assertPostEqualsGet(
        payload({
          name: "POST exclusions",
          categoryIds: [expenseGlobal],
          accountIds: [correctAccount],
        }),
        "130.00",
      ),
    );
    expect(
      await prisma.financialAccount.findMany({
        where: { id: { in: [correctAccount, secondAccount, usdAccount] } },
        select: { id: true, currentBalance: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(beforeRead.accounts);
    expect(
      await prisma.transaction.findMany({
        where: { id: { in: createdMovementIds } },
        select: { id: true, amount: true, status: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(beforeRead.movements);
    await prisma.budget.deleteMany({ where: { id: { in: createdBudgetIds } } });
    await prisma.transaction.deleteMany({ where: { id: { in: createdMovementIds } } });
    await prisma.financialAccount.deleteMany({
      where: { id: { in: [secondAccount, usdAccount] } },
    });
  }, 60_000);
  it("aplica IDOR y permisos de lectura/escritura", async () => {
    expect(
      (await request(app).get(`${base()}/${budgets.general}`).set(auth(actors[1]!.access))).status,
    ).toBe(404);
    const read = await prisma.permission.findUniqueOrThrow({ where: { code: "budgets.read" } }),
      readRole = await prisma.role.create({
        data: { code: `PHASE7_READ_${suffix.slice(0, 16)}`, name: "Phase7 read" },
      });
    await prisma.rolePermission.create({ data: { roleId: readRole.id, permissionId: read.id } });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id } },
      data: { roleId: readRole.id },
    });
    expect((await request(app).get(base()).set(auth(actors[0]!.access))).status).toBe(200);
    expect(
      (await request(app).post(base()).set(auth(actors[0]!.access)).send(payload())).status,
    ).toBe(403);
  }, 30_000);
});
