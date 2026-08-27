import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Phase six secure password 1!";
const actors = ["owner", "other"].map((label) => ({
  email: `phase6-${label}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
}));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const endpoint = (workspaceId = actors[0]!.workspaceId) =>
  `/api/v1/workspaces/${workspaceId}/dashboard`;
const accountIds: string[] = [];
const transactionIds: string[] = [];
let customCategoryId = "";

describe.sequential("Fase 6 dashboard financiero real", () => {
  afterAll(async () => {
    const workspaces = actors.map((actor) => actor.workspaceId).filter(Boolean);
    const users = actors.map((actor) => actor.id).filter(Boolean);
    if (workspaces.length) {
      await prisma.transaction.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await prisma.category.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await prisma.financialAccount.deleteMany({ where: { workspaceId: { in: workspaces } } });
    }
    const owner = await prisma.role.findUnique({ where: { code: "OWNER" } });
    if (owner && actors[0]!.workspaceId && actors[0]!.id)
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id },
        data: { roleId: owner.id },
      });
    await prisma.rolePermission.deleteMany({
      where: { role: { code: { startsWith: "PHASE6_" } } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: "PHASE6_" } } });
    if (users.length) {
      await prisma.workspace.deleteMany({ where: { ownerUserId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    await prisma.$disconnect();
  });

  it("prepara dos workspaces aislados y confirma el dashboard vacío", async () => {
    for (const actor of actors) {
      const { user, workspace, login } = await registerVerified({
        email: actor.email, password, firstName: "Phase6",
      });
      actor.id = user.id;
      actor.access = login.body.data.tokens.accessToken;
      actor.workspaceId = workspace.id;
    }
    const empty = await request(app)
      .get(endpoint(actors[1]!.workspaceId))
      .set(auth(actors[1]!.access));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({
      baseCurrency: "COP",
      summariesByCurrency: [
        {
          currency: "COP",
          availableMoney: "0.00",
          totalIncome: "0.00",
          totalExpenses: "0.00",
          netCashFlow: "0.00",
          netWorth: "0.00",
        },
      ],
      accountBalances: [],
      recentTransactions: [],
      expensesByCategory: [],
      accountsByType: [],
    });
  }, 60_000);

  it("prepara cuentas, categorías y movimientos representativos", async () => {
    const createAccount = async (
      workspaceId: string,
      name: string,
      balance: string,
      options: {
        nature?: "ASSET" | "LIABILITY";
        type?: "SAVINGS" | "CREDIT_CARD";
        currency?: string;
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
            openingBalance: balance,
            currentBalance: balance,
            includeInNetWorth: options.includeInNetWorth ?? true,
            isActive: options.isActive ?? true,
            isFavorite: options.isFavorite ?? false,
          },
        })
      ).id;
    accountIds.push(
      await createAccount(actors[0]!.workspaceId, "Activo favorito", "1000.00", {
        isFavorite: true,
      }),
      await createAccount(actors[0]!.workspaceId, "Pasivo", "-300.00", {
        nature: "LIABILITY",
        type: "CREDIT_CARD",
      }),
      await createAccount(actors[0]!.workspaceId, "Excluida", "500.00", {
        includeInNetWorth: false,
      }),
      await createAccount(actors[0]!.workspaceId, "Archivada", "999.00", { isActive: false }),
      await createAccount(actors[0]!.workspaceId, "Dólares", "50.00", { currency: "USD" }),
      await createAccount(actors[1]!.workspaceId, "Ajena", "777.00"),
    );
    const incomeCategory = await prisma.category.findFirstOrThrow({
      where: { workspaceId: null, type: "INCOME" },
    });
    const expenseCategory = await prisma.category.findFirstOrThrow({
      where: { workspaceId: null, type: "EXPENSE" },
    });
    const transferCategory = await prisma.category.findFirstOrThrow({
      where: { workspaceId: null, type: "TRANSFER" },
    });
    customCategoryId = (
      await prisma.category.create({
        data: {
          workspaceId: actors[0]!.workspaceId,
          name: `Histórica ${suffix.slice(0, 8)}`,
          type: "EXPENSE",
          icon: "history",
          color: "#123456",
          isSystem: false,
          isActive: false,
          deletedAt: new Date("2026-08-20T00:00:00Z"),
        },
      })
    ).id;
    const createMovement = async (data: {
      workspaceId?: string;
      type: "INCOME" | "EXPENSE" | "TRANSFER" | "INVESTMENT";
      status?: "CONFIRMED" | "CANCELLED";
      amount: string;
      currency?: string;
      accountId?: string;
      destinationAccountId?: string;
      categoryId: string;
      occurredAt: string;
      deletedAt?: Date;
      description: string;
    }) => {
      const workspaceId = data.workspaceId ?? actors[0]!.workspaceId;
      const createdBy = workspaceId === actors[0]!.workspaceId ? actors[0]!.id : actors[1]!.id;
      const row = await prisma.transaction.create({
        data: {
          workspaceId,
          createdBy,
          type: data.type,
          status: data.status ?? "CONFIRMED",
          amount: data.amount,
          currency: data.currency ?? "COP",
          accountId: data.accountId ?? accountIds[0]!,
          ...(data.destinationAccountId !== undefined
            ? { destinationAccountId: data.destinationAccountId }
            : {}),
          categoryId: data.categoryId,
          occurredAt: new Date(data.occurredAt),
          ...(data.deletedAt !== undefined ? { deletedAt: data.deletedAt } : {}),
          description: data.description,
        },
      });
      transactionIds.push(row.id);
      return row;
    };
    await createMovement({
      type: "INCOME",
      amount: "500",
      categoryId: incomeCategory.id,
      occurredAt: "2026-08-10T12:00:00Z",
      description: "Ingreso actual",
    });
    await createMovement({
      type: "EXPENSE",
      amount: "100",
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-11T12:00:00Z",
      description: "Gasto global",
    });
    await createMovement({
      type: "EXPENSE",
      amount: "300",
      categoryId: customCategoryId,
      occurredAt: "2026-08-12T12:00:00Z",
      description: "Gasto histórico",
    });
    await createMovement({
      type: "TRANSFER",
      amount: "200",
      accountId: accountIds[0]!,
      destinationAccountId: accountIds[2]!,
      categoryId: transferCategory.id,
      occurredAt: "2026-08-13T12:00:00Z",
      description: "Transferencia",
    });
    await createMovement({
      type: "EXPENSE",
      status: "CANCELLED",
      amount: "999",
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-14T12:00:00Z",
      deletedAt: new Date("2026-08-14T13:00:00Z"),
      description: "Cancelado",
    });
    await createMovement({
      type: "EXPENSE",
      amount: "50",
      categoryId: expenseCategory.id,
      occurredAt: "2026-07-15T12:00:00Z",
      description: "Gasto anterior",
    });
    await createMovement({
      type: "INCOME",
      amount: "20",
      currency: "USD",
      accountId: accountIds[4]!,
      categoryId: incomeCategory.id,
      occurredAt: "2026-08-15T12:00:00Z",
      description: "Ingreso USD",
    });
    await createMovement({
      type: "EXPENSE",
      amount: "5",
      currency: "USD",
      accountId: accountIds[4]!,
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-16T12:00:00Z",
      description: "Gasto USD",
    });
    await createMovement({
      type: "INVESTMENT",
      amount: "900",
      categoryId: expenseCategory.id,
      occurredAt: "2026-08-17T12:00:00Z",
      description: "Tipo aplazado",
    });
    await createMovement({
      workspaceId: actors[1]!.workspaceId,
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
      },
      {
        currency: "USD",
        availableMoney: "50.00",
        totalIncome: "20.00",
        totalExpenses: "5.00",
        netCashFlow: "15.00",
        netWorth: "50.00",
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

  it("agrupa categorías históricas, tipos de cuenta y porcentajes por moneda", async () => {
    const response = await request(app)
      .get(`${endpoint()}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31`)
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    const cop = response.body.data.expensesByCategory.filter(
      (item: { currency: string }) => item.currency === "COP",
    );
    expect(cop.map((item: { amount: string }) => item.amount)).toEqual(["300.00", "100.00"]);
    expect(cop.map((item: { percentage: string }) => item.percentage)).toEqual(["75.00", "25.00"]);
    expect(
      cop.find((item: { categoryId: string }) => item.categoryId === customCategoryId),
    ).toMatchObject({ icon: "history", color: "#123456" });
    expect(
      response.body.data.expensesByCategory.find(
        (item: { currency: string }) => item.currency === "USD",
      ),
    ).toMatchObject({ amount: "5.00", percentage: "100.00" });
    expect(response.body.data.accountsByType).toEqual(
      expect.arrayContaining([
        {
          type: "CREDIT_CARD",
          nature: "LIABILITY",
          currency: "COP",
          accountCount: 1,
          totalBalance: "-300.00",
        },
        {
          type: "SAVINGS",
          nature: "ASSET",
          currency: "USD",
          accountCount: 1,
          totalBalance: "50.00",
        },
      ]),
    );
  }, 30_000);

  it("compara el periodo anterior y usa null sin base comparable", async () => {
    const response = await request(app)
      .get(`${endpoint()}?period=CUSTOM&dateFrom=2026-08-01&dateTo=2026-08-31`)
      .set(auth(actors[0]!.access));
    const cop = response.body.data.comparisonByCurrency.find(
      (item: { currency: string }) => item.currency === "COP",
    );
    expect(cop).toMatchObject({
      currentIncome: "500.00",
      previousIncome: "0.00",
      incomeChangeAmount: "500.00",
      incomeChangePercentage: null,
      currentExpenses: "400.00",
      previousExpenses: "50.00",
      expenseChangeAmount: "350.00",
      expenseChangePercentage: "700.00",
      currentNetCashFlow: "100.00",
      previousNetCashFlow: "-50.00",
    });
  }, 30_000);

  it("aplica recentLimit y orden estable", async () => {
    const response = await request(app)
      .get(`${endpoint()}?recentLimit=2`)
      .set(auth(actors[0]!.access));
    expect(response.status).toBe(200);
    const expected = await prisma.transaction.findMany({
      where: {
        workspaceId: actors[0]!.workspaceId,
        status: "CONFIRMED",
        deletedAt: null,
        type: { in: ["INCOME", "EXPENSE", "TRANSFER"] },
      },
      select: { id: true },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 2,
    });
    expect(response.body.data.recentTransactions.map((row: { id: string }) => row.id)).toEqual(
      expected.map((row) => row.id),
    );
  }, 30_000);

  it.each(["CURRENT_MONTH", "PREVIOUS_MONTH", "LAST_7_DAYS", "LAST_30_DAYS"])(
    "acepta el periodo %s",
    async (period) => {
      const response = await request(app)
        .get(`${endpoint()}?period=${period}`)
        .set(auth(actors[0]!.access));
      expect(response.status).toBe(200);
      expect(response.body.data.period.type).toBe(period);
    },
    30_000,
  );

  it("rechaza parámetros inválidos, ausencia de sesión e IDOR", async () => {
    expect(
      (
        await request(app)
          .get(`${endpoint()}?period=CUSTOM&dateFrom=2026-08-01`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`${endpoint()}?period=CURRENT_MONTH&dateFrom=2026-08-01`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(400);
    expect((await request(app).get(endpoint())).status).toBe(401);
    expect((await request(app).get(endpoint()).set(auth(actors[1]!.access))).status).toBe(404);
  }, 30_000);

  it("exige reports.read y no modifica ninguna fila al consultar", async () => {
    const beforeAccounts = await prisma.financialAccount.findMany({
      where: { workspaceId: actors[0]!.workspaceId },
      select: { id: true, currentBalance: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    const beforeTransactions = await prisma.transaction.findMany({
      where: { workspaceId: actors[0]!.workspaceId },
      select: { id: true, version: true, status: true, updatedAt: true, deletedAt: true },
      orderBy: { id: "asc" },
    });
    const reportPermission = await prisma.permission.findUniqueOrThrow({
      where: { code: "reports.read" },
    });
    const reportRole = await prisma.role.create({
      data: { code: `PHASE6_REPORT_${suffix.slice(0, 16)}`, name: "Phase6 report" },
    });
    await prisma.rolePermission.create({
      data: { roleId: reportRole.id, permissionId: reportPermission.id },
    });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id } },
      data: { roleId: reportRole.id },
    });
    expect((await request(app).get(endpoint()).set(auth(actors[0]!.access))).status).toBe(200);
    const deniedRole = await prisma.role.create({
      data: { code: `PHASE6_DENIED_${suffix.slice(0, 16)}`, name: "Phase6 denied" },
    });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id } },
      data: { roleId: deniedRole.id },
    });
    expect((await request(app).get(endpoint()).set(auth(actors[0]!.access))).status).toBe(403);
    expect(
      await prisma.financialAccount.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, currentBalance: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(beforeAccounts);
    expect(
      await prisma.transaction.findMany({
        where: { workspaceId: actors[0]!.workspaceId },
        select: { id: true, version: true, status: true, updatedAt: true, deletedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(beforeTransactions);
  }, 30_000);
});
