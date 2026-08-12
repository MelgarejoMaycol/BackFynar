import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { authenticate } from "../../src/common/middlewares/authenticate.js";
import { errorHandler } from "../../src/common/middlewares/error-handler.js";
import {
  requirePermission,
  resolveWorkspaceContext,
} from "../../src/modules/workspaces/workspace-context.js";

const suffix = randomUUID().replaceAll("-", "");
const password = "Phase two secure password 1!";
const users = [
  {
    email: `phase2-a-${suffix}@example.com`,
    firstName: "Usuario A",
    id: "",
    access: "",
    refreshCookie: "",
    workspaceId: "",
  },
  {
    email: `phase2-b-${suffix}@example.com`,
    firstName: "Usuario B",
    id: "",
    access: "",
    refreshCookie: "",
    workspaceId: "",
  },
];
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const refreshCookieFrom = (response: request.Response): string =>
  ((response.headers["set-cookie"] as string[] | undefined)?.[0] ?? "").split(";", 1)[0]!;
let temporaryRolePermission: { roleId: string; permissionId: string } | undefined;

describe.sequential("Fase 2 real e aislamiento", () => {
  afterAll(async () => {
    if (temporaryRolePermission)
      await prisma.rolePermission.deleteMany({ where: temporaryRolePermission });
    const ids = users.map(({ id }) => id).filter(Boolean);
    if (ids.length) {
      await prisma.workspace.deleteMany({ where: { ownerUserId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it("registra dos identidades aisladas", async () => {
    for (const user of users) {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: user.email, password, firstName: user.firstName, acceptedTerms: true });
      expect(response.status).toBe(201);
      user.id = response.body.data.user.id as string;
      await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } });
      const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password });
      user.access = login.body.data.tokens.accessToken as string;
      user.refreshCookie = refreshCookieFrom(login);
      user.workspaceId = (
        await prisma.workspace.findFirstOrThrow({
          where: { ownerUserId: user.id },
          select: { id: true },
        })
      ).id;
    }
  }, 60_000);

  it("exige una sesion valida en todos los endpoints", async () => {
    expect((await request(app).get("/api/v1/users/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/users/me/preferences")).status).toBe(401);
    expect((await request(app).get("/api/v1/workspaces")).status).toBe(401);
    expect((await request(app).get(`/api/v1/workspaces/${users[0]!.workspaceId}`)).status).toBe(
      401,
    );
  });

  it("consulta y actualiza solo el perfil propio", async () => {
    const profile = await request(app).get("/api/v1/users/me").set(bearer(users[0]!.access));
    expect(profile.status).toBe(200);
    expect(profile.body.data.email).toBe(users[0]!.email);
    expect(JSON.stringify(profile.body)).not.toMatch(/passwordHash|deletedAt|lastLoginAt/);
    const updated = await request(app)
      .patch("/api/v1/users/me")
      .set(bearer(users[0]!.access))
      .send({
        firstName: "  María 李  ",
        phone: "+57 300 123 4567",
        avatarUrl: "https://example.com/a.png",
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ firstName: "María 李", phone: "+57 300 123 4567" });
    expect(
      (await request(app).patch("/api/v1/users/me").set(bearer(users[0]!.access)).send({})).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch("/api/v1/users/me")
          .set(bearer(users[0]!.access))
          .send({ email: "attacker@example.com" })
      ).status,
    ).toBe(400);
  });

  it("consulta, actualiza y protege preferencias", async () => {
    const current = await request(app)
      .get("/api/v1/users/me/preferences")
      .set(bearer(users[0]!.access));
    expect(current.status).toBe(200);
    const updated = await request(app)
      .patch("/api/v1/users/me/preferences")
      .set(bearer(users[0]!.access))
      .send({
        theme: "DARK",
        timezone: "America/Bogota",
        dashboardLayout: { widgets: ["summary"] },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.theme).toBe("DARK");
    expect(
      (
        await request(app)
          .patch("/api/v1/users/me/preferences")
          .set(bearer(users[0]!.access))
          .send({ defaultWorkspaceId: users[1]!.workspaceId })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch("/api/v1/users/me/preferences")
          .set(bearer(users[0]!.access))
          .send({ defaultWorkspaceId: users[0]!.workspaceId })
      ).status,
    ).toBe(200);
  });

  it("lista, consulta y selecciona solo workspaces autorizados", async () => {
    const list = await request(app).get("/api/v1/workspaces").set(bearer(users[0]!.access));
    expect(list.status).toBe(200);
    expect(list.body.data.map(({ id }: { id: string }) => id)).toEqual([users[0]!.workspaceId]);
    expect(list.body.data[0].role).toBe("OWNER");
    expect(list.body.data[0].permissions).toContain("accounts.read");
    expect(
      (
        await request(app)
          .get(`/api/v1/workspaces/${users[1]!.workspaceId}`)
          .set(bearer(users[0]!.access))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/v1/workspaces/${users[1]!.workspaceId}/select`)
          .set(bearer(users[0]!.access))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/workspaces/${users[0]!.workspaceId}`)
          .set(bearer(users[1]!.access))
      ).status,
    ).toBe(404);
    const selected = await request(app)
      .post(
        `/api/v1/workspaces/${users[0]!.workspaceId}/select?workspaceId=${users[1]!.workspaceId}`,
      )
      .set(bearer(users[0]!.access))
      .send({ workspaceId: users[1]!.workspaceId });
    expect(selected.status).toBe(200);
    expect(selected.body.data.defaultWorkspaceId).toBe(users[0]!.workspaceId);
  }, 30_000);

  it("bloquea membresia y workspace inactivos", async () => {
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: users[0]!.workspaceId, userId: users[0]!.id } },
      data: { status: "SUSPENDED" },
    });
    expect(
      (
        await request(app)
          .get(`/api/v1/workspaces/${users[0]!.workspaceId}`)
          .set(bearer(users[0]!.access))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch("/api/v1/users/me/preferences")
          .set(bearer(users[0]!.access))
          .send({ defaultWorkspaceId: users[0]!.workspaceId })
      ).status,
    ).toBe(404);
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: users[0]!.workspaceId, userId: users[0]!.id } },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: users[0]!.workspaceId },
      data: { isActive: false },
    });
    expect(
      (
        await request(app)
          .get(`/api/v1/workspaces/${users[0]!.workspaceId}`)
          .set(bearer(users[0]!.access))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch("/api/v1/users/me/preferences")
          .set(bearer(users[0]!.access))
          .send({ defaultWorkspaceId: users[0]!.workspaceId })
      ).status,
    ).toBe(404);
    await prisma.workspace.update({
      where: { id: users[0]!.workspaceId },
      data: { isActive: true },
    });
  });

  it("rechaza workspaceId con formato invalido", async () => {
    expect(
      (await request(app).get("/api/v1/workspaces/not-a-uuid").set(bearer(users[0]!.access)))
        .status,
    ).toBe(400);
  });

  it("evalua permisos actuales desde PostgreSQL y por workspace", async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { code: "VIEWER" } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: "accounts.read" },
    });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: users[1]!.workspaceId, userId: users[1]!.id } },
      data: { roleId: viewer.id },
    });
    await prisma.rolePermission.create({
      data: { roleId: viewer.id, permissionId: permission.id },
    });
    temporaryRolePermission = { roleId: viewer.id, permissionId: permission.id };
    const guarded = express();
    guarded.get(
      "/workspaces/:workspaceId/probe",
      authenticate,
      resolveWorkspaceContext,
      requirePermission("accounts.read"),
      (_request, response) => response.status(204).send(),
    );
    guarded.get(
      "/workspaces/:workspaceId/denied",
      authenticate,
      resolveWorkspaceContext,
      requirePermission("accounts.write"),
      (_request, response) => response.status(204).send(),
    );
    guarded.use(errorHandler);
    expect(
      (
        await request(guarded)
          .get(`/workspaces/${users[1]!.workspaceId}/probe`)
          .set(bearer(users[1]!.access))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(guarded)
          .get(`/workspaces/${users[1]!.workspaceId}/denied`)
          .set(bearer(users[1]!.access))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(guarded)
          .get(`/workspaces/${users[1]!.workspaceId}/probe`)
          .set(bearer(users[0]!.access))
      ).status,
    ).toBe(404);
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: viewer.id, permissionId: permission.id } },
    });
    temporaryRolePermission = undefined;
    expect(
      (
        await request(guarded)
          .get(`/workspaces/${users[1]!.workspaceId}/probe`)
          .set(bearer(users[1]!.access))
      ).status,
    ).toBe(403);
  });

  it("una sesion revocada deja de acceder", async () => {
    expect(
      (await request(app).post("/api/v1/auth/logout").set("Cookie", users[0]!.refreshCookie))
        .status,
    ).toBe(204);
    expect((await request(app).get("/api/v1/users/me").set(bearer(users[0]!.access))).status).toBe(
      401,
    );
  });
});
