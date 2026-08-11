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
}

export const usersRepository = new UsersRepository();
