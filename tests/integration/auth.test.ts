import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import { passwordService } from "../../src/modules/auth/auth-password.service.js";
import type { EmailService, PasswordResetEmail } from "../../src/modules/auth/email.service.js";

class CapturingEmailService implements EmailService {
  lastEmail?: PasswordResetEmail;
  async sendPasswordReset(input: PasswordResetEmail): Promise<void> {
    this.lastEmail = input;
  }
  async sendVerification(): Promise<void> {}
}
class FailingEmailService implements EmailService {
  async sendPasswordReset(): Promise<void> {
    throw new Error("synthetic-provider-failure");
  }
  async sendVerification(): Promise<void> {
    throw new Error("synthetic-provider-failure");
  }
}

const suffix = randomUUID().replaceAll("-", "");
const email = `phase1-${suffix}@example.com`;
const password = "Correct horse battery staple 1!";
let userId = "";
let accessToken = "";
let refreshCookie = "";

const cookieFrom = (response: request.Response): string => {
  const setCookie = response.headers["set-cookie"] as unknown;
  if (!Array.isArray(setCookie) || typeof setCookie[0] !== "string") {
    throw new Error("La respuesta no incluyó la cookie de refresh");
  }
  return setCookie[0].split(";", 1)[0]!;
};
const rawTokenFrom = (cookie: string): string =>
  decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
const expectSecureRefreshCookie = (response: request.Response): void => {
  const header = (response.headers["set-cookie"] as string[] | undefined)?.[0] ?? "";
  expect(header).toContain("fynar_refresh_token=");
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Lax");
  expect(header).toContain("Path=/api/v1/auth");
};
const expectClearedRefreshCookie = (response: request.Response): void => {
  const header = (response.headers["set-cookie"] as string[] | undefined)?.[0] ?? "";
  expect(header).toContain("fynar_refresh_token=");
  expect(header).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
};

describe.sequential("autenticacion real", () => {
  beforeAll(async () => {
    await prisma.role.findUniqueOrThrow({ where: { code: "OWNER" } });
  });
  afterAll(async () => {
    if (userId) {
      await prisma.workspace.deleteMany({ where: { ownerUserId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("revierte el usuario si falla una etapa posterior del registro", async () => {
    const rollbackEmail = `rollback-${suffix}@example.com`;
    const blocker = await prisma.user.create({
      data: {
        email: `blocker-${suffix}@example.com`,
        passwordHash: await passwordService.hash(password),
        firstName: "Blocker",
        authIdentities: {
          create: {
            provider: "LOCAL",
            providerSubject: rollbackEmail,
            providerEmail: rollbackEmail,
          },
        },
      },
    });
    try {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: rollbackEmail, password, firstName: "Rollback", acceptedTerms: true });
      expect(response.status).toBe(409);
      expect(await prisma.user.findUnique({ where: { email: rollbackEmail } })).toBeNull();
      expect(await prisma.workspace.count({ where: { users: { email: rollbackEmail } } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: blocker.id } });
    }
  }, 30_000);

  it("registra atomicamente las cinco entidades y evita duplicados", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password, firstName: "Phase", lastName: "Test", acceptedTerms: true });
    expect(response.status).toBe(201);
    userId = response.body.data.user.id as string;
    expect(response.body.data.verificationRequired).toBe(true);
    expect(response.headers["set-cookie"]).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        authIdentities: true,
        workspaces: { include: { workspaceMembers: { include: { roles: true } } } },
        userPreferences: true,
      },
    });
    expect(user.authIdentities).toHaveLength(1);
    expect(user.authIdentities[0]?.provider).toBe("LOCAL");
    expect(user.isEmailVerified).toBe(false);
    expect(user.termsAcceptedAt).not.toBeNull();
    expect(user.privacyAcceptedAt).not.toBeNull();
    expect(await prisma.emailVerificationToken.count({ where: { userId } })).toBe(1);
    expect(user.workspaces[0]?.type).toBe("PERSONAL");
    expect(user.workspaces[0]?.workspaceMembers[0]?.roles.code).toBe("OWNER");
    expect(user.userPreferences?.defaultWorkspaceId).toBe(user.workspaces[0]?.id);
    const duplicate = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password, firstName: "Duplicate", acceptedTerms: true });
    expect(duplicate.status).toBe(409);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  }, 30_000);

  it("protege login, JWT y me", async () => {
    const unverified = await request(app).post("/api/v1/auth/login").send({ email, password });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe("EMAIL_NOT_VERIFIED");
    await prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } });
    expect(
      (await request(app).post("/api/v1/auth/login").send({ email, password: "wrong-password" }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: `missing-${email}`, password })
      ).status,
    ).toBe(401);
    const logged = await request(app).post("/api/v1/auth/login").send({ email, password });
    expect(logged.status).toBe(200);
    accessToken = logged.body.data.tokens.accessToken as string;
    refreshCookie = cookieFrom(logged);
    expectSecureRefreshCookie(logged);
    expect(logged.body.data.tokens).not.toHaveProperty("refreshToken");
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(email);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|providerSubject|tokenHash/);
    expect(
      (await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${accessToken}x`))
        .status,
    ).toBe(401);
  }, 30_000);

  it("rota refresh y revoca la familia al reutilizarlo", async () => {
    const originalCookie = refreshCookie;
    const rotated = await request(app).post("/api/v1/auth/refresh").set("Cookie", originalCookie);
    expect(rotated.status).toBe(200);
    const nextCookie = cookieFrom(rotated);
    expect(rotated.body.data).not.toHaveProperty("refreshToken");
    expect(
      (await request(app).post("/api/v1/auth/refresh").set("Cookie", originalCookie)).status,
    ).toBe(401);
    expect((await request(app).post("/api/v1/auth/refresh").set("Cookie", nextCookie)).status).toBe(
      401,
    );
    const family = await prisma.refreshToken.findUniqueOrThrow({
      where: {
        tokenHash: (await import("../../src/modules/auth/auth-token.service.js")).hashOpaqueToken(
          rawTokenFrom(nextCookie),
        ),
      },
    });
    expect(
      await prisma.refreshToken.count({ where: { familyId: family.familyId, revokedAt: null } }),
    ).toBe(0);
  });

  it("rechaza refresh sin cookie o con una sesión revocada y limpia la cookie", async () => {
    const missing = await request(app).post("/api/v1/auth/refresh");
    expect(missing.status).toBe(401);
    expectClearedRefreshCookie(missing);

    const logged = await request(app).post("/api/v1/auth/login").send({ email, password });
    const revokedCookie = cookieFrom(logged);
    await new AuthService(prisma, passwordService, new CapturingEmailService()).logout(
      rawTokenFrom(revokedCookie),
    );
    const revoked = await request(app).post("/api/v1/auth/refresh").set("Cookie", revokedCookie);
    expect(revoked.status).toBe(401);
    expectClearedRefreshCookie(revoked);
  });

  it("resuelve dos rotaciones concurrentes sin dejar una familia activa", async () => {
    const logged = await request(app).post("/api/v1/auth/login").send({ email, password });
    const concurrentCookie = cookieFrom(logged);
    const responses = await Promise.all([
      request(app).post("/api/v1/auth/refresh").set("Cookie", concurrentCookie),
      request(app).post("/api/v1/auth/refresh").set("Cookie", concurrentCookie),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 401]);
    const { hashOpaqueToken } = await import("../../src/modules/auth/auth-token.service.js");
    const original = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(rawTokenFrom(concurrentCookie)) },
    });
    expect(
      await prisma.refreshToken.count({ where: { familyId: original.familyId, revokedAt: null } }),
    ).toBe(0);
  }, 30_000);

  it("hace logout idempotente y logout global", async () => {
    const logged = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = logged.body.data.tokens.accessToken as string;
    refreshCookie = cookieFrom(logged);
    const loggedOut = await request(app).post("/api/v1/auth/logout").set("Cookie", refreshCookie);
    expect(loggedOut.status).toBe(204);
    expectClearedRefreshCookie(loggedOut);
    expect(
      (await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${accessToken}`))
        .status,
    ).toBe(401);
    const repeatedLogout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", refreshCookie);
    expect(repeatedLogout.status).toBe(204);
    expectClearedRefreshCookie(repeatedLogout);
    const again = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = again.body.data.tokens.accessToken as string;
    const all = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Cookie", cookieFrom(again));
    expect(all.status).toBe(204);
    expectClearedRefreshCookie(all);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  }, 30_000);

  it("recupera password una sola vez y revoca sesiones", async () => {
    const failingService = new AuthService(prisma, passwordService, new FailingEmailService());
    await expect(failingService.forgotPassword(email, {})).resolves.toBeUndefined();
    expect(
      await prisma.passwordResetToken.count({
        where: { userId, consumedAt: null, revokedAt: null },
      }),
    ).toBe(0);
    const fake = new CapturingEmailService();
    const service = new AuthService(prisma, passwordService, fake);
    await service.login(email, password, {});
    await service.forgotPassword(email, {});
    const resetUrl = fake.lastEmail?.resetUrl;
    expect(resetUrl).toBeTruthy();
    const token = new URL(resetUrl!).searchParams.get("token")!;
    await expect(
      service.resetPassword(`${token}altered`, "Another valid password 3!"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const expiredRaw = `expired-${randomUUID()}-${randomUUID()}`;
    const { hashOpaqueToken } = await import("../../src/modules/auth/auth-token.service.js");
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(expiredRaw),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await expect(
      service.resetPassword(expiredRaw, "Another valid password 3!"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await service.resetPassword(token, "A completely new password 2!");
    await expect(service.resetPassword(token, "Another valid password 3!")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect((await request(app).post("/api/v1/auth/login").send({ email, password })).status).toBe(
      401,
    );
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email, password: "A completely new password 2!" })
      ).status,
    ).toBe(200);
    const existingNeutral = await request(app).post("/api/v1/auth/forgot-password").send({ email });
    const missingNeutral = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: `missing-${email}` });
    expect(missingNeutral.status).toBe(202);
    expect({ status: existingNeutral.status, body: existingNeutral.body }).toEqual({
      status: missingNeutral.status,
      body: missingNeutral.body,
    });
  }, 60_000);

  it("limita intentos repetidos de login", async () => {
    let status = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      status = (
        await request(app).post("/api/v1/auth/login").send({ email, password: "always-wrong" })
      ).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  }, 30_000);

  it("limita intentos repetidos de refresh", async () => {
    let status = 0;
    for (let attempt = 0; attempt < 35; attempt += 1) {
      status = (await request(app).post("/api/v1/auth/refresh")).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  }, 30_000);
});
