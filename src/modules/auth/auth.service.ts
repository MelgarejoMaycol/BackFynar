import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { env } from "../../config/env.js";
import { AppError, ConflictError, UnauthorizedError } from "../../common/errors/app-error.js";
import { logger } from "../../common/logging/logger.js";
import { passwordService, type PasswordService } from "./auth-password.service.js";
import { createOpaqueToken, hashOpaqueToken, signAccessToken } from "./auth-token.service.js";
import { emailService, type EmailService } from "./email.service.js";
import type { RegisterInput } from "./auth.schemas.js";

const INVALID_CREDENTIALS = new UnauthorizedError(
  "Credenciales invalidas",
  "Correo o contrasena incorrectos",
);
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$x+0YQeoFWerFnWI4JtQgHQ$VgYxEwav6eKxFNzyev6h0gm0LrHvnUzPvPoy69tj12o";
const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  isEmailVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
}

const expiresFromNow = (days: number): Date => new Date(Date.now() + days * 86_400_000);
export class AuthService {
  constructor(
    private readonly database: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly emails: EmailService,
  ) {}

  private async createSession(userId: string, metadata: SessionMetadata) {
    const refreshToken = createOpaqueToken();
    const familyId = randomUUID();
    const session = await this.database.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashOpaqueToken(refreshToken),
        expiresAt: expiresFromNow(env.REFRESH_TOKEN_TTL_DAYS),
        ...metadata,
      },
    });
    return {
      accessToken: await signAccessToken({ userId, sessionId: session.id }),
      refreshToken,
      accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_MINUTES * 60,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  async register(input: RegisterInput, metadata: SessionMetadata) {
    const passwordHash = await this.passwords.hash(input.password);
    const initialRefreshToken = createOpaqueToken();
    const initialFamilyId = randomUUID();
    try {
      const registration = await withTransactionRetry(() =>
        this.database.$transaction(
          async (tx) => {
            const owner = await tx.role.findUnique({
              where: { code: "OWNER" },
              select: { id: true },
            });
            if (!owner) throw new AppError("El rol OWNER no esta configurado");
            const created = await tx.user.create({
              data: {
                email: input.email,
                passwordHash,
                firstName: input.firstName,
                ...(input.lastName ? { lastName: input.lastName } : {}),
              },
              select: publicUserSelect,
            });
            await tx.authIdentity.create({
              data: {
                userId: created.id,
                provider: "LOCAL",
                providerSubject: created.email,
                providerEmail: created.email,
              },
            });
            const workspace = await tx.workspace.create({
              data: {
                name: `Espacio de ${created.firstName}`,
                type: "PERSONAL",
                ownerUserId: created.id,
              },
            });
            await tx.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId: created.id,
                roleId: owner.id,
                status: "ACTIVE",
                joinedAt: new Date(),
              },
            });
            await tx.userPreference.create({
              data: { userId: created.id, defaultWorkspaceId: workspace.id },
            });
            const session = await tx.refreshToken.create({
              data: {
                userId: created.id,
                familyId: initialFamilyId,
                tokenHash: hashOpaqueToken(initialRefreshToken),
                expiresAt: expiresFromNow(env.REFRESH_TOKEN_TTL_DAYS),
                ...metadata,
              },
            });
            return { user: created, session };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
      return {
        user: registration.user,
        tokens: {
          accessToken: await signAccessToken({
            userId: registration.user.id,
            sessionId: registration.session.id,
          }),
          refreshToken: initialRefreshToken,
          accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_MINUTES * 60,
          refreshTokenExpiresAt: registration.session.expiresAt,
        },
      };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Email duplicado", "No fue posible completar el registro");
      }
      throw error;
    }
  }

  async login(email: string, password: string, metadata: SessionMetadata) {
    const user = await this.database.user.findUnique({
      where: { email },
      include: { authIdentities: { where: { provider: "LOCAL" }, select: { id: true } } },
    });
    const validPassword = await this.passwords.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!user || !validPassword || user.authIdentities.length === 0) throw INVALID_CREDENTIALS;
    if (!user.isActive || user.deletedAt)
      throw new UnauthorizedError("Usuario inactivo", "No fue posible iniciar sesion");
    await this.database.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { user: await this.me(user.id), tokens: await this.createSession(user.id, metadata) };
  }

  async refresh(rawToken: string, metadata: SessionMetadata) {
    const tokenHash = hashOpaqueToken(rawToken);
    const current = await this.database.refreshToken.findUnique({
      where: { tokenHash },
      include: { users: { select: { isActive: true, deletedAt: true } } },
    });
    if (!current) throw new UnauthorizedError("Refresh token desconocido", "Sesion invalida");
    if (
      current.revokedAt ||
      current.usedAt ||
      current.expiresAt <= new Date() ||
      !current.users.isActive ||
      current.users.deletedAt
    ) {
      await this.database.refreshToken.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: "REUSE_DETECTED" },
      });
      throw new UnauthorizedError("Reutilizacion de refresh token", "Sesion invalida");
    }
    const nextRawToken = createOpaqueToken();
    const rotation = await withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const usedAt = new Date();
          const claimed = await tx.refreshToken.updateMany({
            where: { id: current.id, usedAt: null, revokedAt: null, expiresAt: { gt: usedAt } },
            data: { usedAt, revokedAt: usedAt, revocationReason: "ROTATED" },
          });
          if (claimed.count !== 1) {
            await tx.refreshToken.updateMany({
              where: { familyId: current.familyId, revokedAt: null },
              data: { revokedAt: usedAt, revocationReason: "REUSE_DETECTED" },
            });
            return { status: "reused" as const };
          }
          const created = await tx.refreshToken.create({
            data: {
              userId: current.userId,
              familyId: current.familyId,
              parentTokenId: current.id,
              tokenHash: hashOpaqueToken(nextRawToken),
              expiresAt: expiresFromNow(env.REFRESH_TOKEN_TTL_DAYS),
              ...metadata,
            },
          });
          await tx.refreshToken.update({
            where: { id: current.id },
            data: { replacedById: created.id },
          });
          return { status: "rotated" as const, token: created };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    if (rotation.status === "reused")
      throw new UnauthorizedError("Rotacion concurrente detectada", "Sesion invalida");
    const next = rotation.token;
    return {
      accessToken: await signAccessToken({ userId: next.userId, sessionId: next.id }),
      refreshToken: nextRawToken,
      accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_MINUTES * 60,
      refreshTokenExpiresAt: next.expiresAt,
    };
  }

  async logout(rawToken: string): Promise<void> {
    await this.database.refreshToken.updateMany({
      where: { tokenHash: hashOpaqueToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "LOGOUT" },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.database.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "LOGOUT_ALL" },
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.database.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { passwordHash: true },
    });
    const valid = await this.passwords.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      currentPassword,
    );
    if (!user || !valid)
      throw new UnauthorizedError(
        "Contraseña actual incorrecta",
        "La contraseña actual no es correcta",
      );
    const passwordHash = await this.passwords.hash(newPassword);
    await this.database.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, updatedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: "PASSWORD_CHANGE" },
      });
    });
  }

  async me(userId: string) {
    const user = await this.database.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: publicUserSelect,
    });
    if (!user) throw new UnauthorizedError();
    return user;
  }

  async forgotPassword(email: string, metadata: SessionMetadata): Promise<void> {
    const startedAt = Date.now();
    const user = await this.database.user.findFirst({
      where: { email, isActive: true, deletedAt: null },
    });
    if (user) {
      const rawToken = createOpaqueToken();
      const record = await this.database.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashOpaqueToken(rawToken),
            expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000),
            ...(metadata.ipAddress ? { requestIpAddress: metadata.ipAddress } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
          },
        });
      });
      const url = new URL(env.PASSWORD_RESET_PATH, env.APP_WEB_URL);
      url.searchParams.set("token", rawToken);
      try {
        await this.emails.sendPasswordReset({ recipient: user.email, resetUrl: url.toString() });
      } catch (error: unknown) {
        logger.error("Fallo el envio del correo de recuperacion", {
          errorName: error instanceof Error ? error.name : "Unknown",
          resetTokenId: record.id,
        });
        try {
          await this.database.passwordResetToken.update({
            where: { id: record.id },
            data: { revokedAt: new Date() },
          });
        } catch (revocationError: unknown) {
          logger.error("Fallo la revocacion del token de recuperacion no entregado", {
            errorName: revocationError instanceof Error ? revocationError.name : "Unknown",
            resetTokenId: record.id,
          });
        }
      }
    }
    const remaining = 250 - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    const tokenHash = hashOpaqueToken(rawToken);
    await withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const token = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
          const now = new Date();
          if (!token || token.consumedAt || token.revokedAt || token.expiresAt <= now) {
            throw new UnauthorizedError(
              "Token de recuperacion invalido",
              "Token invalido o expirado",
            );
          }
          const consumed = await tx.passwordResetToken.updateMany({
            where: { id: token.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1)
            throw new UnauthorizedError("Consumo concurrente", "Token invalido o expirado");
          await tx.user.update({
            where: { id: token.userId },
            data: { passwordHash, updatedAt: now },
          });
          await tx.passwordResetToken.updateMany({
            where: {
              userId: token.userId,
              id: { not: token.id },
              consumedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
          await tx.refreshToken.updateMany({
            where: { userId: token.userId, revokedAt: null },
            data: { revokedAt: now, revocationReason: "PASSWORD_RESET" },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}

export const authService = new AuthService(prisma, passwordService, emailService);
