import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { registerVerified } from "./helpers/register-verified.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Phase three secure password 1!";
const actors = ["a", "b"].map((label) => ({
  email: `phase3-${label}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
  refreshCookie: "",
}));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const refreshCookieFrom = (response: request.Response): string =>
  ((response.headers["set-cookie"] as string[] | undefined)?.[0] ?? "").split(";", 1)[0]!;
const base = (actor: (typeof actors)[number]) => `/api/v1/workspaces/${actor.workspaceId}/accounts`;
let accountA = "";
let accountB = "";

describe.sequential("Fase 3 cuentas reales", () => {
  afterAll(async () => {
    const ids = actors.map((x) => x.id).filter(Boolean);
    if (ids.length) {
      await prisma.financialAccount.deleteMany({
        where: { workspaceId: { in: actors.map((x) => x.workspaceId).filter(Boolean) } },
      });
      await prisma.workspace.deleteMany({ where: { ownerUserId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });
  it("prepara dos usuarios y workspaces", async () => {
    for (const actor of actors) {
      const { user, workspace, login } = await registerVerified({
        email: actor.email,
        password,
        firstName: "Phase3",
      });
      actor.id = user.id;
      actor.access = login.body.data.tokens.accessToken;
      actor.refreshCookie = refreshCookieFrom(login);
      actor.workspaceId = workspace.id;
    }
  }, 60_000);
  it("OWNER crea cuentas y las tarjetas usan su modulo especializado", async () => {
    const a = await request(app).post(base(actors[0]!)).set(auth(actors[0]!.access)).send({
      name: "Ahorros",
      type: "SAVINGS",
      nature: "ASSET",
      currency: "COP",
      openingBalance: "1500000.25",
    });
    expect(a.status).toBe(201);
    accountA = a.body.data.id;
    expect(a.body.data).toMatchObject({
      openingBalance: "1500000.25",
      currentBalance: "1500000.25",
    });
    const rejectedCard = await request(app)
      .post(base(actors[1]!))
      .set(auth(actors[1]!.access))
      .send({
        name: "Tarjeta incorrecta",
        type: "CREDIT_CARD",
        nature: "LIABILITY",
        currency: "COP",
        openingBalance: "0.00",
        creditLimit: "5000000.00",
        billingDay: 10,
        paymentDueDay: 28,
      });
    expect(rejectedCard.status).toBe(400);
    const b = await request(app)
      .post(`/api/v1/workspaces/${actors[1]!.workspaceId}/cards`)
      .set(auth(actors[1]!.access))
      .send({ name: "Tarjeta", currency: "COP", creditLimit: "5000000.00", usedCredit: "250.10" });
    expect(b.status).toBe(201);
    accountB = b.body.data.id;
  }, 30_000);
  it("lista, detalla y actualiza sin aceptar saldos calculados", async () => {
    const list = await request(app).get(base(actors[0]!)).set(auth(actors[0]!.access));
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([accountA]);
    expect(
      (
        await request(app)
          .get(`${base(actors[0]!)}/${accountA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(200);
    const rejectedBalance = await request(app)
      .patch(`${base(actors[0]!)}/${accountA}`)
      .set(auth(actors[0]!.access))
      .send({ name: "Ahorros principal", openingBalance: "2000000.10" });
    expect(rejectedBalance.status).toBe(400);
    const update = await request(app)
      .patch(`${base(actors[0]!)}/${accountA}`)
      .set(auth(actors[0]!.access))
      .send({ name: "Ahorros principal" });
    expect(update.status).toBe(200);
    expect(update.body.data).toMatchObject({
      openingBalance: "1500000.25",
      currentBalance: "1500000.25",
    });
    expect(
      (
        await request(app)
          .patch(`${base(actors[0]!)}/${accountA}`)
          .set(auth(actors[0]!.access))
          .send({ currentBalance: "9.00" })
      ).status,
    ).toBe(400);
    const withCard = await request(app).get(base(actors[1]!)).set(auth(actors[1]!.access));
    const withoutCard = await request(app)
      .get(`${base(actors[1]!)}?excludeCreditCards=true`)
      .set(auth(actors[1]!.access));
    expect(withCard.body.data.map((item: { id: string }) => item.id)).toContain(accountB);
    expect(withoutCard.body.data.map((item: { id: string }) => item.id)).not.toContain(accountB);
  }, 30_000);
  it("favorito, archivo, filtro y restauracion son coherentes", async () => {
    expect(
      (
        await request(app)
          .patch(`${base(actors[0]!)}/${accountA}/favorite`)
          .set(auth(actors[0]!.access))
          .send({ isFavorite: true })
      ).body.data.isFavorite,
    ).toBe(true);
    expect(
      (
        await request(app)
          .post(`${base(actors[0]!)}/${accountA}/archive`)
          .set(auth(actors[0]!.access))
      ).body.data.isActive,
    ).toBe(false);
    expect(
      (await request(app).get(base(actors[0]!)).set(auth(actors[0]!.access))).body.data,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .get(`${base(actors[0]!)}?archived=true`)
          .set(auth(actors[0]!.access))
      ).body.data,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .post(`${base(actors[0]!)}/${accountA}/restore`)
          .set(auth(actors[0]!.access))
      ).body.data.isActive,
    ).toBe(true);
  }, 30_000);
  it("impide todas las variantes de acceso cruzado", async () => {
    const own = base(actors[0]!);
    for (const operation of [
      request(app).get(`${own}/${accountB}`),
      request(app).patch(`${own}/${accountB}`).send({ name: "Ataque" }),
      request(app).patch(`${own}/${accountB}/favorite`).send({ isFavorite: true }),
      request(app).post(`${own}/${accountB}/archive`),
      request(app).post(`${own}/${accountB}/restore`),
      request(app).delete(`${own}/${accountB}`),
    ])
      expect((await operation.set(auth(actors[0]!.access))).status).toBe(404);
    expect(
      (
        await request(app)
          .get(`${base(actors[1]!)}/${accountA}`)
          .set(auth(actors[1]!.access))
      ).status,
    ).toBe(404);
    const b = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountB } });
    expect(b.name).toBe("Tarjeta");
    expect(b.deletedAt).toBeNull();
  }, 30_000);
  it("aplica permisos, membresia y workspace en tiempo real", async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { code: "VIEWER" } });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[1]!.workspaceId, userId: actors[1]!.id } },
      data: { roleId: viewer.id },
    });
    expect((await request(app).get(base(actors[1]!)).set(auth(actors[1]!.access))).status).toBe(
      403,
    );
    expect(
      (
        await request(app).post(base(actors[1]!)).set(auth(actors[1]!.access)).send({
          name: "No",
          type: "CASH",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "0.00",
        })
      ).status,
    ).toBe(403);
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id } },
      data: { status: "SUSPENDED" },
    });
    expect((await request(app).get(base(actors[0]!)).set(auth(actors[0]!.access))).status).toBe(
      404,
    );
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: actors[0]!.workspaceId, userId: actors[0]!.id } },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: actors[0]!.workspaceId },
      data: { isActive: false },
    });
    expect((await request(app).get(base(actors[0]!)).set(auth(actors[0]!.access))).status).toBe(
      404,
    );
    await prisma.workspace.update({
      where: { id: actors[0]!.workspaceId },
      data: { isActive: true },
    });
  }, 30_000);
  it("responde 409 y revierte PATCH cuando el nombre ya existe", async () => {
    const accountPath = base(actors[0]!);
    const create = (name: string) =>
      request(app).post(accountPath).set(auth(actors[0]!.access)).send({
        name,
        type: "CASH",
        nature: "ASSET",
        currency: "COP",
        openingBalance: "10.00",
      });
    const createdA = await create("Duplicado A");
    const createdB = await create("Duplicado B");
    expect([createdA.status, createdB.status]).toEqual([201, 201]);
    const ids = [createdA.body.data.id, createdB.body.data.id] as string[];
    const before = await prisma.financialAccount.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, openingBalance: true, currentBalance: true, updatedAt: true },
      orderBy: { id: "asc" },
    });

    const collision = await request(app)
      .patch(`${accountPath}/${createdB.body.data.id}`)
      .set(auth(actors[0]!.access))
      .send({ name: "Duplicado A" });
    expect(collision.status).toBe(409);
    expect(collision.body.error.message).not.toContain("P2002");

    const after = await prisma.financialAccount.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, openingBalance: true, currentBalance: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
  }, 30_000);
  it("permite reutilizar el nombre tras una eliminación física segura", async () => {
    const accountPath = base(actors[0]!);
    const payload = {
      name: "Nombre eliminado reservado",
      type: "CASH",
      nature: "ASSET",
      currency: "COP",
      openingBalance: "25.00",
    };
    const created = await request(app).post(accountPath).set(auth(actors[0]!.access)).send(payload);
    expect(created.status).toBe(201);
    expect(
      (
        await request(app)
          .delete(`${accountPath}/${created.body.data.id}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(200);

    const duplicate = await request(app)
      .post(accountPath)
      .set(auth(actors[0]!.access))
      .send(payload);
    expect(duplicate.status).toBe(201);

    const stored = await prisma.financialAccount.findMany({
      where: { workspaceId: actors[0]!.workspaceId, name: payload.name },
      select: { id: true, deletedAt: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: duplicate.body.data.id, deletedAt: null });
  }, 30_000);
  it("elimina físicamente una cuenta sin historial y la excluye de consultas", async () => {
    expect(
      (
        await request(app)
          .delete(`${base(actors[0]!)}/${accountA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`${base(actors[0]!)}/${accountA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(404);
    expect(await prisma.financialAccount.findUnique({ where: { id: accountA } })).toBeNull();
    expect(
      (
        await request(app)
          .delete(`${base(actors[0]!)}/${accountA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(404);
  }, 30_000);
  it("valida UUID, propiedades y sesion revocada", async () => {
    expect(
      (
        await request(app)
          .get(`/api/v1/workspaces/${actors[0]!.workspaceId}/accounts/not-uuid`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(`${base(actors[0]!)}?workspaceId=${actors[1]!.workspaceId}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app).post(base(actors[0]!)).set(auth(actors[0]!.access)).send({
          name: "X",
          type: "CASH",
          nature: "ASSET",
          currency: "COP",
          openingBalance: "0.00",
          workspaceId: actors[1]!.workspaceId,
        })
      ).status,
    ).toBe(400);
    await request(app).post("/api/v1/auth/logout").set("Cookie", actors[0]!.refreshCookie);
    expect((await request(app).get(base(actors[0]!)).set(auth(actors[0]!.access))).status).toBe(
      401,
    );
  }, 30_000);
});
