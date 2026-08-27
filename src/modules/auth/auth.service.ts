import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { env } from "../../config/env.js";
import { AppError, ConflictError, UnauthorizedError } from "../../common/errors/app-error.js";
import { logger } from "../../common/logging/logger.js";
import { passwordService, type PasswordService } from "./auth-password.service.js";
import { createOpaqueToken, hashOpaqueToken, signAccessToken } from "./auth-token.service.js";
import { EmailProviderError, emailService, type EmailService } from "./email.service.js";
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
export interface GoogleProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName?: string;
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
    const verificationToken = createOpaqueToken();
    if (
      await this.database.user.findUnique({ where: { email: input.email }, select: { id: true } })
    )
      throw new ConflictError("Email duplicado", "No fue posible completar el registro");
    const now = new Date();
    const pending = await this.database.pendingRegistration.upsert({
      where: { email: input.email },
      create: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        ...(input.lastName ? { lastName: input.lastName } : {}),
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        legalVersion: env.LEGAL_VERSION,
        verificationTokenHash: hashOpaqueToken(verificationToken),
        expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3_600_000),
        ...(metadata.ipAddress ? { requestIpAddress: metadata.ipAddress } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      update: {
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        legalVersion: env.LEGAL_VERSION,
        verificationTokenHash: hashOpaqueToken(verificationToken),
        expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3_600_000),
        emailSentAt: null,
        consumedAt: null,
        revokedAt: null,
        updatedAt: now,
      },
    });
    const url = new URL(env.EMAIL_VERIFICATION_PATH, env.APP_WEB_URL);
    url.searchParams.set("token", verificationToken);
    try {
      await this.emails.sendVerification({
        recipient: pending.email,
        firstName: pending.firstName,
        verificationUrl: url.toString(),
        expiresInHours: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
      });
      await this.database.pendingRegistration.update({
        where: { id: pending.id },
        data: { emailSentAt: new Date() },
      });
    } catch (error: unknown) {
      logger.error("Fallo el envio del correo de verificacion", {
        errorName: error instanceof Error ? error.name : "Unknown",
        providerStatus: error instanceof EmailProviderError ? error.status : undefined,
        providerCode: error instanceof EmailProviderError ? error.providerCode : undefined,
        providerMessage: error instanceof EmailProviderError ? error.providerMessage : undefined,
        emailKind: "registration-verification",
        recipientDomain: pending.email.split("@")[1],
        pendingRegistrationId: pending.id,
      });
      await this.database.pendingRegistration
        .delete({ where: { id: pending.id } })
        .catch(() => undefined);
      throw new AppError("El proveedor de correo rechazó el envío", {
        status: 503,
        code: "EMAIL_PROVIDER_ERROR",
        safeToExpose: true,
        publicMessage: "No pudimos enviar el correo. Inténtalo nuevamente.",
      });
    }
    return { user: { email: pending.email, firstName: pending.firstName } };
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
    if (!user.isEmailVerified)
      throw new AppError("Correo no verificado", {
        status: 403,
        code: "EMAIL_NOT_VERIFIED",
        safeToExpose: true,
        publicMessage: "Tu correo todavía no ha sido verificado",
      });
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

  async loginWithGoogle(profile: GoogleProfile, acceptedTerms: boolean, metadata: SessionMetadata) {
    if (!profile.emailVerified)
      throw new AppError("Google no verificó el correo", {
        status: 403,
        code: "GOOGLE_EMAIL_NOT_VERIFIED",
        safeToExpose: true,
        publicMessage: "Google no confirmó la propiedad de este correo",
      });
    const existingIdentity = await this.database.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: profile.subject } },
      select: { userId: true },
    });
    let userId = existingIdentity?.userId;
    if (!userId) {
      const existingUser = await this.database.user.findUnique({
        where: { email: profile.email },
        select: {
          id: true,
          isActive: true,
          deletedAt: true,
          authIdentities: {
            where: { provider: "GOOGLE" },
            select: { providerSubject: true },
          },
        },
      });
      if (existingUser) {
        if (!existingUser.isActive || existingUser.deletedAt)
          throw new UnauthorizedError("Usuario inactivo", "No fue posible iniciar sesión");
        if (
          existingUser.authIdentities[0] &&
          existingUser.authIdentities[0].providerSubject !== profile.subject
        )
          throw new AppError("Conflicto de identidad Google", {
            status: 409,
            code: "GOOGLE_ACCOUNT_CONFLICT",
            safeToExpose: true,
            publicMessage: "No fue posible vincular esta cuenta de Google",
          });
        await this.database.$transaction(async (tx) => {
          await tx.authIdentity.create({
            data: {
              userId: existingUser.id,
              provider: "GOOGLE",
              providerSubject: profile.subject,
              providerEmail: profile.email,
            },
          });
          await tx.user.update({
            where: { id: existingUser.id },
            data: { isEmailVerified: true, updatedAt: new Date() },
          });
        });
        userId = existingUser.id;
      } else {
        if (!acceptedTerms)
          throw new AppError("Aceptación legal requerida", {
            status: 400,
            code: "LEGAL_ACCEPTANCE_REQUIRED",
            safeToExpose: true,
            publicMessage: "Debes aceptar los términos y la política de privacidad",
          });
        const created = await withTransactionRetry(() =>
          this.database.$transaction(
            async (tx) => {
              const owner = await tx.role.findUnique({
                where: { code: "OWNER" },
                select: { id: true },
              });
              if (!owner) throw new AppError("El rol OWNER no esta configurado");
              const now = new Date();
              const user = await tx.user.create({
                data: {
                  email: profile.email,
                  firstName: profile.firstName,
                  ...(profile.lastName ? { lastName: profile.lastName } : {}),
                  isEmailVerified: true,
                  termsAcceptedAt: now,
                  privacyAcceptedAt: now,
                  legalVersion: env.LEGAL_VERSION,
                },
                select: { id: true, firstName: true },
              });
              await tx.authIdentity.create({
                data: {
                  userId: user.id,
                  provider: "GOOGLE",
                  providerSubject: profile.subject,
                  providerEmail: profile.email,
                },
              });
              const workspace = await tx.workspace.create({
                data: {
                  name: `Espacio de ${user.firstName}`,
                  type: "PERSONAL",
                  ownerUserId: user.id,
                },
              });
              await tx.workspaceMember.create({
                data: {
                  workspaceId: workspace.id,
                  userId: user.id,
                  roleId: owner.id,
                  status: "ACTIVE",
                  joinedAt: now,
                },
              });
              await tx.userPreference.create({
                data: { userId: user.id, defaultWorkspaceId: workspace.id },
              });
              return user;
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        );
        userId = created.id;
      }
    }
    await this.database.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return { user: await this.me(userId), tokens: await this.createSession(userId, metadata) };
  }

  async resendVerification(email: string, metadata: SessionMetadata): Promise<void> {
    const pending = await this.database.pendingRegistration.findUnique({ where: { email } });
    if (pending && !pending.consumedAt) {
      const rawToken = createOpaqueToken();
      const updated = await this.database.pendingRegistration.update({
        where: { id: pending.id },
        data: {
          verificationTokenHash: hashOpaqueToken(rawToken),
          expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3_600_000),
          emailSentAt: null,
          revokedAt: null,
          updatedAt: new Date(),
        },
      });
      const url = new URL(env.EMAIL_VERIFICATION_PATH, env.APP_WEB_URL);
      url.searchParams.set("token", rawToken);
      try {
        await this.emails.sendVerification({
          recipient: updated.email,
          firstName: updated.firstName,
          verificationUrl: url.toString(),
          expiresInHours: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
        });
        await this.database.pendingRegistration.update({
          where: { id: updated.id },
          data: { emailSentAt: new Date() },
        });
      } catch (error: unknown) {
        await this.database.pendingRegistration
          .update({ where: { id: updated.id }, data: { revokedAt: new Date() } })
          .catch(() => undefined);
        logger.error("Falló el reenvío de registro pendiente", {
          errorName: error instanceof Error ? error.name : "Unknown",
          pendingRegistrationId: updated.id,
        });
      }
      return;
    }
    const user = await this.database.user.findFirst({
      where: { email, isActive: true, deletedAt: null },
      select: { id: true, email: true, firstName: true, isEmailVerified: true },
    });
    if (!user || user.isEmailVerified) return;
    const rawToken = createOpaqueToken();
    const record = await this.database.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(rawToken),
          expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3_600_000),
          ...(metadata.ipAddress ? { requestIpAddress: metadata.ipAddress } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
      });
    });
    const url = new URL(env.EMAIL_VERIFICATION_PATH, env.APP_WEB_URL);
    url.searchParams.set("token", rawToken);
    try {
      await this.emails.sendVerification({
        recipient: user.email,
        firstName: user.firstName,
        verificationUrl: url.toString(),
        expiresInHours: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
      });
    } catch (error: unknown) {
      await this.database.emailVerificationToken
        .update({ where: { id: record.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      logger.error("Fallo el reenvio de verificacion", {
        errorName: error instanceof Error ? error.name : "Unknown",
        verificationTokenId: record.id,
      });
    }
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    const pending = await this.database.pendingRegistration.findUnique({
      where: { verificationTokenHash: tokenHash },
    });
    if (pending) {
      await withTransactionRetry(() =>
        this.database.$transaction(
          async (tx) => {
            const now = new Date();
            const current = await tx.pendingRegistration.findUnique({ where: { id: pending.id } });
            if (!current || current.consumedAt || current.revokedAt)
              throw new AppError("Token utilizado", {
                status: 409,
                code: "VERIFICATION_TOKEN_USED",
                safeToExpose: true,
                publicMessage: "Este enlace de verificación ya fue utilizado",
              });
            if (current.expiresAt <= now)
              throw new AppError("Token expirado", {
                status: 410,
                code: "VERIFICATION_TOKEN_EXPIRED",
                safeToExpose: true,
                publicMessage: "El enlace de verificación ha expirado",
              });
            if (await tx.user.findUnique({ where: { email: current.email }, select: { id: true } }))
              throw new ConflictError("Email duplicado", "Ya existe una cuenta con este correo");
            const owner = await tx.role.findUnique({
              where: { code: "OWNER" },
              select: { id: true },
            });
            if (!owner) throw new AppError("El rol OWNER no está configurado");
            const user = await tx.user.create({
              data: {
                email: current.email,
                passwordHash: current.passwordHash,
                firstName: current.firstName,
                lastName: current.lastName,
                isEmailVerified: true,
                termsAcceptedAt: current.termsAcceptedAt,
                privacyAcceptedAt: current.privacyAcceptedAt,
                legalVersion: current.legalVersion,
              },
            });
            await tx.authIdentity.create({
              data: {
                userId: user.id,
                provider: "LOCAL",
                providerSubject: user.email,
                providerEmail: user.email,
              },
            });
            const workspace = await tx.workspace.create({
              data: {
                name: `Espacio de ${user.firstName}`,
                type: "PERSONAL",
                ownerUserId: user.id,
              },
            });
            await tx.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId: user.id,
                roleId: owner.id,
                status: "ACTIVE",
                joinedAt: now,
              },
            });
            await tx.userPreference.create({
              data: { userId: user.id, defaultWorkspaceId: workspace.id, theme: "LIGHT" },
            });
            const consumed = await tx.pendingRegistration.updateMany({
              where: { id: current.id, consumedAt: null, revokedAt: null },
              data: { consumedAt: now },
            });
            if (consumed.count !== 1)
              throw new AppError("Consumo concurrente", {
                status: 409,
                code: "VERIFICATION_TOKEN_USED",
              });
            await tx.pendingRegistration.updateMany({
              where: {
                email: current.email,
                id: { not: current.id },
                consumedAt: null,
                revokedAt: null,
              },
              data: { revokedAt: now },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
      return;
    }
    await withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
          const now = new Date();
          if (!token)
            throw new AppError("Token desconocido", {
              status: 400,
              code: "VERIFICATION_TOKEN_INVALID",
              safeToExpose: true,
              publicMessage: "El enlace de verificación no es válido",
            });
          if (token.consumedAt || token.revokedAt)
            throw new AppError("Token utilizado", {
              status: 409,
              code: "VERIFICATION_TOKEN_USED",
              safeToExpose: true,
              publicMessage: "Este enlace de verificación ya fue utilizado",
            });
          if (token.expiresAt <= now)
            throw new AppError("Token expirado", {
              status: 410,
              code: "VERIFICATION_TOKEN_EXPIRED",
              safeToExpose: true,
              publicMessage: "El enlace de verificación ha expirado",
            });
          const consumed = await tx.emailVerificationToken.updateMany({
            where: { id: token.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1)
            throw new AppError("Consumo concurrente", {
              status: 409,
              code: "VERIFICATION_TOKEN_USED",
              safeToExpose: true,
              publicMessage: "Este enlace de verificación ya fue utilizado",
            });
          await tx.user.update({
            where: { id: token.userId },
            data: { isEmailVerified: true, updatedAt: now },
          });
          await tx.emailVerificationToken.updateMany({
            where: {
              userId: token.userId,
              id: { not: token.id },
              consumedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
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

  async requestEmailChange(
    userId: string,
    newEmail: string,
    currentPassword: string,
    metadata: SessionMetadata,
  ) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      include: { authIdentities: { where: { provider: "LOCAL" } } },
    });
    if (
      !user ||
      !user.passwordHash ||
      user.authIdentities.length === 0 ||
      !(await this.passwords.verify(user.passwordHash, currentPassword))
    )
      throw new UnauthorizedError("Contraseña incorrecta", "La contraseña actual no es correcta");
    if (user.email === newEmail)
      throw new AppError("Correo sin cambios", {
        status: 400,
        code: "EMAIL_UNCHANGED",
        safeToExpose: true,
        publicMessage: "Ingresa un correo diferente",
      });
    if (await this.database.user.findUnique({ where: { email: newEmail }, select: { id: true } }))
      throw new ConflictError("Correo ocupado", "Este correo no está disponible");
    const rawToken = createOpaqueToken();
    const record = await this.database.$transaction(async (tx) => {
      await tx.emailChangeRequest.updateMany({
        where: { userId, consumedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.emailChangeRequest.create({
        data: {
          userId,
          newEmail,
          tokenHash: hashOpaqueToken(rawToken),
          expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 3_600_000),
          ...(metadata.ipAddress ? { requestIpAddress: metadata.ipAddress } : {}),
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
      });
    });
    const url = new URL("/verify-email-change", env.APP_WEB_URL);
    url.searchParams.set("token", rawToken);
    try {
      await this.emails.sendVerification({
        recipient: newEmail,
        firstName: user.firstName,
        verificationUrl: url.toString(),
        expiresInHours: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
      });
      await this.database.emailChangeRequest.update({
        where: { id: record.id },
        data: { emailSentAt: new Date() },
      });
    } catch {
      await this.database.emailChangeRequest
        .update({ where: { id: record.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      throw new AppError("Fallo proveedor de correo", {
        status: 503,
        code: "EMAIL_PROVIDER_ERROR",
        safeToExpose: true,
        publicMessage: "No pudimos enviar el correo. Inténtalo nuevamente.",
      });
    }
    return { newEmail, expiresAt: record.expiresAt };
  }

  async confirmEmailChange(rawToken: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    await withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const request = await tx.emailChangeRequest.findUnique({ where: { tokenHash } });
          const now = new Date();
          if (!request)
            throw new AppError("Token inválido", {
              status: 400,
              code: "EMAIL_CHANGE_TOKEN_INVALID",
              safeToExpose: true,
            });
          if (request.consumedAt || request.revokedAt)
            throw new AppError("Token utilizado", {
              status: 409,
              code: "EMAIL_CHANGE_TOKEN_USED",
              safeToExpose: true,
            });
          if (request.expiresAt <= now)
            throw new AppError("Token expirado", {
              status: 410,
              code: "EMAIL_CHANGE_TOKEN_EXPIRED",
              safeToExpose: true,
            });
          if (
            await tx.user.findUnique({ where: { email: request.newEmail }, select: { id: true } })
          )
            throw new ConflictError("Correo ocupado", "Este correo ya no está disponible");
          await tx.user.update({
            where: { id: request.userId },
            data: { email: request.newEmail, isEmailVerified: true, updatedAt: now },
          });
          await tx.authIdentity.updateMany({
            where: { userId: request.userId, provider: "LOCAL" },
            data: { providerSubject: request.newEmail, providerEmail: request.newEmail },
          });
          await tx.emailChangeRequest.update({
            where: { id: request.id },
            data: { consumedAt: now },
          });
          await tx.emailChangeRequest.updateMany({
            where: {
              userId: request.userId,
              id: { not: request.id },
              consumedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async getPendingEmailChange(userId: string) {
    return this.database.emailChangeRequest.findFirst({
      where: { userId, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { newEmail: true, expiresAt: true, emailSentAt: true },
    });
  }

  async cancelEmailChange(userId: string): Promise<void> {
    await this.database.emailChangeRequest.updateMany({
      where: { userId, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
