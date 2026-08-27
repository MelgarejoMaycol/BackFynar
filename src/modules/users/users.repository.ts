import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { resolveMembership } from "../workspaces/workspaces.repository.js";

export const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  isEmailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const preferenceSelect = {
  defaultWorkspaceId: true,
  language: true,
  currency: true,
  timezone: true,
  dateFormat: true,
  theme: true,
  startScreen: true,
  dashboardLayout: true,
  financialCycleStartDay: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserPreferenceSelect;

export class UsersRepository {
  constructor(private readonly database: PrismaClient = prisma) {}
  findActiveProfile(userId: string) {
    return this.database.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: publicUserSelect,
    });
  }
  updateActiveProfile(userId: string, data: Prisma.UserUpdateManyMutationInput) {
    return this.database.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, isActive: true, deletedAt: null },
        data,
      });
      if (updated.count !== 1) return null;
      return tx.user.findUnique({ where: { id: userId }, select: publicUserSelect });
    });
  }
  findPreferences(userId: string) {
    return this.database.userPreference.findUnique({ where: { userId }, select: preferenceSelect });
  }
  ensurePreferences(userId: string) {
    return withTransactionRetry(() =>
      this.database.$transaction(async (tx) => {
        const existing = await tx.userPreference.findUnique({
          where: { userId },
          select: preferenceSelect,
        });
        if (existing) return existing;
        const membership = await tx.workspaceMember.findFirst({
          where: { userId, status: "ACTIVE" },
          orderBy: { joinedAt: "asc" },
          select: { workspaceId: true },
        });
        return tx.userPreference.upsert({
          where: { userId },
          create: {
            userId,
            ...(membership ? { defaultWorkspaceId: membership.workspaceId } : {}),
          },
          update: {},
          select: preferenceSelect,
        });
      }),
    );
  }
  updatePreferences(userId: string, data: Prisma.UserPreferenceUpdateInput) {
    return this.database.userPreference.update({
      where: { userId },
      data,
      select: preferenceSelect,
    });
  }
  updatePreferencesForWorkspace(
    userId: string,
    workspaceId: string,
    data: Prisma.UserPreferenceUpdateInput,
  ) {
    return withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          await resolveMembership(userId, workspaceId, tx);
          return tx.userPreference.update({
            where: { userId },
            data,
            select: preferenceSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  anonymizeAccount(userId: string) {
    return withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const user = await tx.user.findFirst({
            where: { id: userId, isActive: true, deletedAt: null },
            select: { id: true },
          });
          if (!user) return false;

          const deletedAt = new Date();
          await tx.auditLog.updateMany({
            where: { entityType: "USER", entityId: userId },
            data: { oldData: Prisma.JsonNull, newData: Prisma.JsonNull },
          });
          await tx.authIdentity.deleteMany({ where: { userId } });
          await tx.refreshToken.deleteMany({ where: { userId } });
          await tx.passwordResetToken.deleteMany({ where: { userId } });
          await tx.emailVerificationToken.deleteMany({ where: { userId } });
          await tx.emailChangeRequest.deleteMany({ where: { userId } });
          await tx.deviceToken.deleteMany({ where: { userId } });
          await tx.notification.deleteMany({ where: { userId } });
          await tx.userPreference.deleteMany({ where: { userId } });
          await tx.user.update({
            where: { id: userId },
            data: {
              email: `deleted-${userId}@deleted.invalid`,
              passwordHash: null,
              firstName: "Cuenta eliminada",
              lastName: null,
              phone: null,
              avatarUrl: null,
              isEmailVerified: false,
              isActive: false,
              deletedAt,
            },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}

export const usersRepository = new UsersRepository();
