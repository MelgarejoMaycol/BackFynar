import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
const suffix = randomUUID().replaceAll("-", "");
const password = "Phase five secure password 1!";
const actors = ["a", "b"].map((label) => ({
  email: `phase5-${label}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
}));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = (i: number) => `/api/v1/workspaces/${actors[i]!.workspaceId}/transactions`;
const accountIds = [] as unknown as [string, string, string, string];
let incomeId = "",
  expenseId = "",
  transferId = "";
let incomeVersion = 1,
  expenseVersion = 1,
  transferVersion = 1;
const occurredAt = "2026-08-05T12:00:00-05:00";
let incomeCategory = "",
  expenseCategory = "",
  secondExpenseCategory = "",
  transferCategory = "";
describe.sequential("Fase 5 movimientos reales", () => {
  afterAll(async () => {
    const ws = actors.map((a) => a.workspaceId).filter(Boolean);
    const users = actors.map((a) => a.id).filter(Boolean);
    if (ws.length) {
      await prisma.transaction.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.category.deleteMany({ where: { workspaceId: { in: ws } } });
      await prisma.financialAccount.deleteMany({ where: { workspaceId: { in: ws } } });
    }
    await prisma.rolePermission.deleteMany({
      where: { role: { code: { startsWith: "PHASE5_" } } },
    });
    await prisma.workspaceMember.deleteMany({
      where: { roles: { code: { startsWith: "PHASE5_" } } },
    });
    await prisma.role.deleteMany({ where: { code: { startsWith: "PHASE5_" } } });
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
        .send({ email: actor.email, password, firstName: "Phase5" });
      expect(r.status).toBe(201);
      actor.id = r.body.data.user.id;
      actor.access = r.body.data.tokens.accessToken;
      actor.workspaceId = (
        await prisma.workspace.findFirstOrThrow({ where: { ownerUserId: actor.id } })
      ).id;
    }
    const make = async (workspaceId: string, name: string, currency = "COP") =>
      (
        await prisma.financialAccount.create({
          data: {
            workspaceId,
            name,
            type: "SAVINGS",
            nature: "ASSET",
            currency,
            openingBalance: "1000.00",
            currentBalance: "1000.00",
          },
        })
      ).id;
    accountIds.push(
      await make(actors[0]!.workspaceId, "Origen"),
      await make(actors[0]!.workspaceId, "Destino"),
      await make(actors[0]!.workspaceId, "Dólares", "USD"),
      await make(actors[1]!.workspaceId, "Ajena"),
    );
    incomeCategory = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "INCOME" } })
    ).id;
    const expenseCategories = await prisma.category.findMany({
      where: { workspaceId: null, type: "EXPENSE" },
      select: { id: true },
      orderBy: { name: "asc" },
      take: 2,
    });
    expenseCategory = expenseCategories[0]!.id;
    secondExpenseCategory = expenseCategories[1]!.id;
    transferCategory = (
      await prisma.category.findFirstOrThrow({ where: { workspaceId: null, type: "TRANSFER" } })
    ).id;
  }, 60_000);
  it("registra ingreso, gasto y transferencia con precisión exacta", async () => {
    const common = { accountId: accountIds[0], occurredAt, description: "Movimiento fase 5" };
    const income = await request(app)
      .post(`${base(0)}/income`)
      .set(auth(actors[0]!.access))
      .send({ ...common, categoryId: incomeCategory, amount: "100.25" });
    expect(income.status).toBe(201);
    incomeId = income.body.data.id;
    incomeVersion = income.body.data.version;
    expect(income.body.data.amount).toBe("100.25");
    const expense = await request(app)
      .post(`${base(0)}/expense`)
      .set(auth(actors[0]!.access))
      .send({ ...common, categoryId: expenseCategory, amount: "50.10" });
    expect(expense.status).toBe(201);
    expenseId = expense.body.data.id;
    expenseVersion = expense.body.data.version;
    const transfer = await request(app)
      .post(`${base(0)}/transfer`)
      .set(auth(actors[0]!.access))
      .send({
        ...common,
        destinationAccountId: accountIds[1],
        categoryId: transferCategory,
        amount: "200.00",
      });
    expect(transfer.status).toBe(201);
    transferId = transfer.body.data.id;
    transferVersion = transfer.body.data.version;
    const balances = await prisma.financialAccount.findMany({
      where: { id: { in: accountIds.slice(0, 2) } },
      orderBy: { name: "asc" },
    });
    expect(balances.find((a) => a.id === accountIds[0])!.currentBalance.toFixed(2)).toBe("850.15");
    expect(balances.find((a) => a.id === accountIds[1])!.currentBalance.toFixed(2)).toBe("1200.00");
  }, 30_000);
  it("lista, filtra, pagina y detalla solo dentro del workspace", async () => {
    const list = await request(app)
      .get(`${base(0)}?type=EXPENSE&page=1&limit=2&search=fase`)
      .set(auth(actors[0]!.access));
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject({ page: 1, limit: 2, total: 1 });
    expect(list.body.data.items[0].id).toBe(expenseId);
    const combined = await request(app)
      .get(`${base(0)}?accountId=${accountIds[0]}&search=Movimiento%20fase%205`)
      .set(auth(actors[0]!.access));
    expect(combined.status).toBe(200);
    expect(combined.body.data.total).toBe(3);
    expect(
      combined.body.data.items.every(
        (item: { accountId: string; destinationAccountId: string | null; description: string }) =>
          (item.accountId === accountIds[0] || item.destinationAccountId === accountIds[0]) &&
          item.description === "Movimiento fase 5",
      ),
    ).toBe(true);
    const textOnly = await request(app)
      .get(`${base(0)}?accountId=${accountIds[2]}&search=Movimiento%20fase%205`)
      .set(auth(actors[0]!.access));
    expect(textOnly.body.data.total).toBe(0);
    const accountOnly = await request(app)
      .get(`${base(0)}?accountId=${accountIds[0]}&search=texto-inexistente`)
      .set(auth(actors[0]!.access));
    expect(accountOnly.body.data.total).toBe(0);
    expect(
      (
        await request(app)
          .get(`${base(0)}/${incomeId}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`${base(1)}/${incomeId}`)
          .set(auth(actors[1]!.access))
      ).status,
    ).toBe(404);
  }, 30_000);
  it("bloquea edición y cancelación para todos los tipos financieros aplazados", async () => {
    const delayedTypes = ["INVESTMENT", "DEBT_PAYMENT", "ADJUSTMENT", "REFUND"] as const;
    for (const type of delayedTypes) {
      const movement = await prisma.transaction.create({
        data: {
          workspaceId: actors[0]!.workspaceId,
          createdBy: actors[0]!.id,
          type,
          status: "CONFIRMED",
          amount: "7.00",
          currency: "COP",
          accountId: accountIds[0],
          categoryId: expenseCategory,
          occurredAt: new Date(occurredAt),
          description: `Tipo aplazado ${type}`,
        },
      });
      const accountBefore = await prisma.financialAccount.findUniqueOrThrow({
        where: { id: accountIds[0] },
        select: { currentBalance: true, updatedAt: true },
      });
      const rowBefore = await prisma.transaction.findUniqueOrThrow({ where: { id: movement.id } });
      const edit = await request(app)
        .patch(`${base(0)}/${movement.id}`)
        .set(auth(actors[0]!.access))
        .send({ version: movement.version, amount: "8.00" });
      expect(edit.status).toBe(409);
      expect(edit.body.error.message).toBe(
        "El tipo de movimiento todavía no admite modificaciones financieras.",
      );
      const cancel = await request(app)
        .delete(`${base(0)}/${movement.id}`)
        .set(auth(actors[0]!.access))
        .send({ version: movement.version });
      expect(cancel.status).toBe(409);
      expect(cancel.body.error.message).toBe(
        "El tipo de movimiento todavía no admite modificaciones financieras.",
      );
      expect(await prisma.transaction.findUniqueOrThrow({ where: { id: movement.id } })).toEqual(
        rowBefore,
      );
      expect(
        await prisma.financialAccount.findUniqueOrThrow({
          where: { id: accountIds[0] },
          select: { currentBalance: true, updatedAt: true },
        }),
      ).toEqual(accountBefore);
    }
  }, 30_000);
  it("rechaza recursos incompatibles y hace rollback", async () => {
    const payload = {
      accountId: accountIds[0],
      categoryId: expenseCategory,
      amount: "5.00",
      occurredAt,
    };
    expect(
      (
        await request(app)
          .post(`${base(0)}/income`)
          .set(auth(actors[0]!.access))
          .send(payload)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${base(0)}/expense`)
          .set(auth(actors[0]!.access))
          .send({ ...payload, accountId: accountIds[3] })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${base(0)}/transfer`)
          .set(auth(actors[0]!.access))
          .send({ ...payload, categoryId: transferCategory, destinationAccountId: accountIds[2] })
      ).status,
    ).toBe(409);
    const before = (
      await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
    ).currentBalance.toFixed(2);
    await prisma.financialAccount.update({
      where: { id: accountIds[2] },
      data: { isActive: false },
    });
    expect(
      (
        await request(app)
          .post(`${base(0)}/expense`)
          .set(auth(actors[0]!.access))
          .send({ ...payload, accountId: accountIds[2] })
      ).status,
    ).toBe(404);
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe(before);
  }, 30_000);
  it("serializa gastos concurrentes sin perder actualizaciones", async () => {
    const payload = {
      accountId: accountIds[0],
      categoryId: expenseCategory,
      amount: "10.00",
      occurredAt,
    };
    const results = await Promise.all([
      request(app)
        .post(`${base(0)}/expense`)
        .set(auth(actors[0]!.access))
        .send(payload),
      request(app)
        .post(`${base(0)}/expense`)
        .set(auth(actors[0]!.access))
        .send(payload),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe("830.15");
  }, 30_000);
  it("edita revirtiendo primero y protege version y rollback", async () => {
    const edited = await request(app)
      .patch(`${base(0)}/${incomeId}`)
      .set(auth(actors[0]!.access))
      .send({
        version: incomeVersion,
        accountId: accountIds[1],
        amount: "150.00",
        occurredAt: "2026-08-06T12:00:00Z",
        description: "Ingreso editado",
      });
    expect(edited.status).toBe(200);
    incomeVersion = edited.body.data.version;
    expect(edited.body.data).toMatchObject({
      accountId: accountIds[1],
      amount: "150.00",
      version: 2,
    });
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe("729.90");
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[1] } })
      ).currentBalance.toFixed(2),
    ).toBe("1350.00");
    const snapshot = await prisma.financialAccount.findMany({
      where: { id: { in: accountIds.slice(0, 2) } },
      select: { id: true, currentBalance: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    expect(
      (
        await request(app)
          .patch(`${base(0)}/${incomeId}`)
          .set(auth(actors[0]!.access))
          .send({ version: 1, amount: "1.00" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`${base(0)}/${incomeId}`)
          .set(auth(actors[0]!.access))
          .send({ version: incomeVersion, categoryId: expenseCategory })
      ).status,
    ).toBe(404);
    expect(
      await prisma.financialAccount.findMany({
        where: { id: { in: accountIds.slice(0, 2) } },
        select: { id: true, currentBalance: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(snapshot);
    const editedExpense = await request(app)
      .patch(`${base(0)}/${expenseId}`)
      .set(auth(actors[0]!.access))
      .send({ version: expenseVersion, amount: "60.00", categoryId: secondExpenseCategory });
    expect(editedExpense.status).toBe(200);
    expenseVersion = editedExpense.body.data.version;
    expect(editedExpense.body.data).toMatchObject({
      amount: "60.00",
      categoryId: secondExpenseCategory,
      version: 2,
    });
    const editedTransfer = await request(app)
      .patch(`${base(0)}/${transferId}`)
      .set(auth(actors[0]!.access))
      .send({ version: transferVersion, amount: "180.00", description: "Transferencia editada" });
    expect(editedTransfer.status).toBe(200);
    transferVersion = editedTransfer.body.data.version;
    expect(editedTransfer.body.data).toMatchObject({ amount: "180.00", version: 2 });
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe("740.00");
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[1] } })
      ).currentBalance.toFixed(2),
    ).toBe("1330.00");
  }, 30_000);
  it("cancela gasto y transferencia sin revertir dos veces", async () => {
    const originalExpenseVersion = expenseVersion;
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${expenseId}`)
          .set(auth(actors[0]!.access))
          .send({ version: originalExpenseVersion })
      ).status,
    ).toBe(204);
    expenseVersion += 1;
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe("800.00");
    const cancelledExpense = await prisma.transaction.findUniqueOrThrow({
      where: { id: expenseId },
    });
    const balanceAfterExpenseCancellation = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: accountIds[0] },
      select: { currentBalance: true, updatedAt: true },
    });
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${expenseId}`)
          .set(auth(actors[0]!.access))
          .send({ version: originalExpenseVersion })
      ).status,
    ).toBe(204);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: expenseId } })).toEqual(
      cancelledExpense,
    );
    expect(
      await prisma.financialAccount.findUniqueOrThrow({
        where: { id: accountIds[0] },
        select: { currentBalance: true, updatedAt: true },
      }),
    ).toEqual(balanceAfterExpenseCancellation);
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe("800.00");
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${transferId}`)
          .set(auth(actors[0]!.access))
          .send({ version: transferVersion - 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${transferId}`)
          .set(auth(actors[0]!.access))
          .send({ version: transferVersion })
      ).status,
    ).toBe(204);
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } })
      ).currentBalance.toFixed(2),
    ).toBe("980.00");
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[1] } })
      ).currentBalance.toFixed(2),
    ).toBe("1150.00");
    expect(await prisma.transaction.count({ where: { id: { in: [expenseId, transferId] } } })).toBe(
      2,
    );
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${incomeId}`)
          .set(auth(actors[0]!.access))
          .send({ version: incomeVersion })
      ).status,
    ).toBe(204);
    expect(
      (
        await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountIds[1] } })
      ).currentBalance.toFixed(2),
    ).toBe("1000.00");
    expect(await prisma.transaction.count({ where: { id: incomeId } })).toBe(1);
  }, 30_000);
  it("aplica RBAC independiente de categories y valida campos", async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { code: "VIEWER" } });
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: actors[0]!.workspaceId,
          userId: actors[0]!.id,
        },
      },
      data: { roleId: viewer.id },
    });
    expect((await request(app).get(base(0)).set(auth(actors[0]!.access))).status).toBe(403);
    const role = await prisma.role.create({
      data: { code: `PHASE5_READ_${suffix.slice(0, 20)}`, name: "Phase5 read" },
    });
    const read = await prisma.permission.findUniqueOrThrow({
      where: { code: "transactions.read" },
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: read.id } });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id } },
      data: { roleId: role.id },
    });
    expect((await request(app).get(base(0)).set(auth(actors[0]!.access))).status).toBe(200);
    expect(
      (
        await request(app)
          .post(`${base(0)}/expense`)
          .set(auth(actors[0]!.access))
          .send({
            accountId: accountIds[0],
            categoryId: expenseCategory,
            amount: "1.00",
            occurredAt,
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base(0)}/expense`)
          .set(auth(actors[0]!.access))
          .send({
            accountId: accountIds[0],
            categoryId: expenseCategory,
            amount: "1.00",
            occurredAt,
            workspaceId: actors[0]!.workspaceId,
          })
      ).status,
    ).toBe(403);
  }, 30_000);
});
