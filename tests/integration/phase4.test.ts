import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Phase four secure password 1!";
const actors = ["a", "b"].map((label) => ({
  email: `phase4-${label}-${suffix}@example.com`,
  id: "",
  workspaceId: "",
  access: "",
}));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = (index: number) => `/api/v1/workspaces/${actors[index]!.workspaceId}/categories`;
const categoryPayload = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "EXPENSE",
  icon: "tag",
  color: "#AABBCC",
  ...extra,
});
let parentA = "";
let childA = "";
let parentB = "";

describe.sequential("Fase 4 categorías reales", () => {
  afterAll(async () => {
    const workspaceIds = actors.map((actor) => actor.workspaceId).filter(Boolean);
    const userIds = actors.map((actor) => actor.id).filter(Boolean);
    if (workspaceIds.length)
      await prisma.category.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    if (userIds.length) {
      await prisma.workspace.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("prepara dos workspaces aislados", async () => {
    for (const actor of actors) {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: actor.email, password, firstName: "Phase4", acceptedTerms: true });
      expect(response.status).toBe(201);
      actor.id = response.body.data.user.id;
      await prisma.user.update({ where: { id: actor.id }, data: { isEmailVerified: true } });
      const login = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password });
      actor.access = login.body.data.tokens.accessToken;
      actor.workspaceId = (
        await prisma.workspace.findFirstOrThrow({
          where: { ownerUserId: actor.id },
          select: { id: true },
        })
      ).id;
    }
  }, 60_000);

  it("lista el catálogo global, permite nombre personalizado equivalente y protege globales", async () => {
    const global = await request(app)
      .get(`${base(0)}?scope=SYSTEM&type=EXPENSE`)
      .set(auth(actors[0]!.access));
    expect(global.status).toBe(200);
    expect(global.body.data).toHaveLength(15);
    const food = global.body.data.find((item: { name: string }) => item.name === "Alimentación");
    expect(food).toMatchObject({ scope: "SYSTEM", isSystem: true, parentId: null });

    const custom = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("Alimentación"));
    expect(custom.status).toBe(201);
    parentA = custom.body.data.id;
    expect(
      (
        await request(app)
          .patch(`${base(0)}/${food.id}`)
          .set(auth(actors[0]!.access))
          .send({ name: "Ataque" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${food.id}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(403);
  }, 30_000);

  it("crea jerarquía, normaliza nombres y aplica unicidad por padre", async () => {
    const child = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("  Comida   rápida  ", { parentId: parentA }));
    expect(child.status).toBe(201);
    expect(child.body.data.name).toBe("Comida rápida");
    childA = child.body.data.id;

    const duplicate = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("comida rápida", { parentId: parentA }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).not.toContain("uq_categories");

    const otherParent = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("Transporte privado"));
    expect(otherParent.status).toBe(201);
    const sameNameOtherParent = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("Comida rápida", { parentId: otherParent.body.data.id }));
    expect(sameNameOtherParent.status).toBe(201);

    expect(
      (
        await request(app)
          .post(base(0))
          .set(auth(actors[0]!.access))
          .send(categoryPayload("Tercer nivel", { parentId: childA }))
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(base(0))
          .set(auth(actors[0]!.access))
          .send(categoryPayload("Tipo incompatible", { type: "INCOME", parentId: parentA }))
      ).status,
    ).toBe(409);
    const sameRootDifferentType = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("Alimentación", { type: "INCOME" }));
    expect(sameRootDifferentType.status).toBe(201);
  }, 30_000);

  it("filtra, consulta y edita campos permitidos con rollback ante colisión", async () => {
    const filtered = await request(app)
      .get(`${base(0)}?parentId=${parentA}&type=EXPENSE&scope=CUSTOM`)
      .set(auth(actors[0]!.access));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((item: { id: string }) => item.id)).toContain(childA);
    expect(
      (
        await request(app)
          .get(`${base(0)}/${childA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(200);
    const updated = await request(app)
      .patch(`${base(0)}/${childA}`)
      .set(auth(actors[0]!.access))
      .send({ name: "Restaurantes", icon: "utensils", color: "#abcdef" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      name: "Restaurantes",
      icon: "utensils",
      color: "#ABCDEF",
    });
    expect(
      (
        await request(app)
          .patch(`${base(0)}/${childA}`)
          .set(auth(actors[0]!.access))
          .send({ type: "INCOME" })
      ).status,
    ).toBe(400);
    const collision = await request(app)
      .patch(`${base(0)}/${childA}`)
      .set(auth(actors[0]!.access))
      .send({ name: "Alimentación", parentId: null });
    expect(collision.status).toBe(409);
    const stored = await prisma.category.findUniqueOrThrow({ where: { id: childA } });
    expect(stored).toMatchObject({ name: "Restaurantes", parentId: parentA });
  }, 30_000);

  it("impide padres ajenos y cualquier IDOR entre workspaces", async () => {
    const created = await request(app)
      .post(base(1))
      .set(auth(actors[1]!.access))
      .send(categoryPayload("Workspace B"));
    expect(created.status).toBe(201);
    parentB = created.body.data.id;
    expect(
      (
        await request(app)
          .post(base(0))
          .set(auth(actors[0]!.access))
          .send(categoryPayload("Padre ajeno", { parentId: parentB }))
      ).status,
    ).toBe(404);
    for (const operation of [
      request(app).get(`${base(0)}/${parentB}`),
      request(app)
        .patch(`${base(0)}/${parentB}`)
        .send({ name: "Ataque" }),
      request(app).delete(`${base(0)}/${parentB}`),
      request(app).post(`${base(0)}/${parentB}/restore`),
    ])
      expect((await operation.set(auth(actors[0]!.access))).status).toBe(404);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: parentB } })).name).toBe(
      "Workspace B",
    );
  }, 30_000);

  it("archiva, reserva el nombre y restaura sin borrar físicamente", async () => {
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${parentA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .delete(`${base(0)}/${childA}`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(204);
    const archived = await prisma.category.findUniqueOrThrow({ where: { id: childA } });
    expect(archived.deletedAt).toBeInstanceOf(Date);
    expect(archived.isActive).toBe(false);
    const duplicate = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("restaurantes", { parentId: parentA }));
    expect(duplicate.status).toBe(409);
    const archivedList = await request(app)
      .get(`${base(0)}?status=ARCHIVED&scope=CUSTOM`)
      .set(auth(actors[0]!.access));
    expect(archivedList.body.data.map((item: { id: string }) => item.id)).toContain(childA);
    const restored = await request(app)
      .post(`${base(0)}/${childA}/restore`)
      .set(auth(actors[0]!.access));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ isActive: true, name: "Restaurantes" });
    expect(
      (
        await request(app)
          .post(`${base(0)}/${childA}/restore`)
          .set(auth(actors[0]!.access))
      ).status,
    ).toBe(200);
  }, 30_000);

  it("serializa creaciones equivalentes concurrentes", async () => {
    const responses = await Promise.all([
      request(app)
        .post(base(0))
        .set(auth(actors[0]!.access))
        .send(categoryPayload("  Concurrente   única ")),
      request(app)
        .post(base(0))
        .set(auth(actors[0]!.access))
        .send(categoryPayload("concurrente única")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.category.count({
        where: { workspaceId: actors[0]!.workspaceId, name: { contains: "Concurrente" } },
      }),
    ).toBe(1);
  }, 30_000);

  it("impide mover bajo otro padre una categoría con hijos sin alterar filas", async () => {
    const create = async (name: string, parentId?: string) => {
      const response = await request(app)
        .post(base(0))
        .set(auth(actors[0]!.access))
        .send(categoryPayload(name, parentId ? { parentId } : {}));
      expect(response.status).toBe(201);
      return response.body.data.id as string;
    };
    const parent = await create("Jerarquía padre A");
    const child = await create("Jerarquía hijo B", parent);
    const destination = await create("Jerarquía padre C");
    const ids = [parent, child, destination];
    const select = {
      id: true,
      name: true,
      parentId: true,
      icon: true,
      color: true,
      isActive: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
    const before = await prisma.category.findMany({
      where: { id: { in: ids } },
      select,
      orderBy: { id: "asc" },
    });

    const rejected = await request(app)
      .patch(`${base(0)}/${parent}`)
      .set(auth(actors[0]!.access))
      .send({ parentId: destination });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.message).toContain("mientras tenga subcategorías activas");

    const after = await prisma.category.findMany({
      where: { id: { in: ids } },
      select,
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
    expect(after.find((category) => category.id === parent)?.parentId).toBeNull();
    expect(after.find((category) => category.id === child)?.parentId).toBe(parent);
    expect(
      await prisma.category.count({
        where: { id: { in: ids }, parentId: { not: null }, otherCategories: { some: {} } },
      }),
    ).toBe(0);
  }, 30_000);

  it("permite mover bajo un padre principal una categoría sin hijos", async () => {
    const movable = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("Categoría movible"));
    const destination = await request(app)
      .post(base(0))
      .set(auth(actors[0]!.access))
      .send(categoryPayload("Destino principal"));
    expect([movable.status, destination.status]).toEqual([201, 201]);

    const moved = await request(app)
      .patch(`${base(0)}/${movable.body.data.id}`)
      .set(auth(actors[0]!.access))
      .send({ parentId: destination.body.data.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.parentId).toBe(destination.body.data.id);
    expect(
      (
        await prisma.category.findUniqueOrThrow({
          where: { id: movable.body.data.id },
          select: { parentId: true },
        })
      ).parentId,
    ).toBe(destination.body.data.id);
  }, 30_000);

  it("aplica categories.read y categories.write desde PostgreSQL", async () => {
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
    expect((await request(app).get(base(0)).set(auth(actors[0]!.access))).status).toBe(200);
    expect(
      (
        await request(app)
          .post(base(0))
          .set(auth(actors[0]!.access))
          .send(categoryPayload("Sin escritura"))
      ).status,
    ).toBe(403);
  }, 30_000);
});
