import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../database/prisma.js";
import { withTransactionRetry } from "../../database/transaction-retry.js";
import { AppError } from "../../common/errors/app-error.js";
import type { WorkspaceMembershipContext } from "./workspaces.types.js";

const membershipSelect = {
  workspaceId: true,
  userId: true,
  status: true,
  workspaces: {
    select: {
      id: true,
      name: true,
      type: true,
      baseCurrency: true,
      timezone: true,
      isActive: true,
    },
  },
  roles: {
    select: {
      id: true,
      code: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  },
} satisfies Prisma.WorkspaceMemberSelect;

const workspaceNotFound = () =>
  new AppError("Workspace o membresia activa no encontrada", {
    status: 404,
    code: "WORKSPACE_NOT_FOUND",
    publicMessage: "Workspace no encontrado",
  });

const toContext = (membership: {
  workspaceId: string;
  userId: string;
  status: string;
  workspaces: WorkspaceMembershipContext["workspace"];
  roles: { id: string; code: string; permissions: { permission: { code: string } }[] };
}): WorkspaceMembershipContext => ({
  workspaceId: membership.workspaceId,
  userId: membership.userId,
  roleId: membership.roles.id,
  roleCode: membership.roles.code,
  permissions: membership.roles.permissions.map(({ permission }) => permission.code).sort(),
  workspace: membership.workspaces,
});

export async function resolveMembership(
  userId: string,
  workspaceId: string,
  database: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<WorkspaceMembershipContext> {
  const membership = await database.workspaceMember.findFirst({
    where: {
      userId,
      workspaceId,
      status: "ACTIVE",
      workspaces: { isActive: true, deletedAt: null },
      usersWorkspaceMembersUserIdTousers: { isActive: true, deletedAt: null },
    },
    select: membershipSelect,
  });
  if (!membership) throw workspaceNotFound();
  return toContext(membership);
}

export class WorkspacesRepository {
  constructor(private readonly database: PrismaClient = prisma) {}
  async listForUser(userId: string) {
    const [memberships, preference] = await Promise.all([
      this.database.workspaceMember.findMany({
        where: {
          userId,
          status: "ACTIVE",
          workspaces: { isActive: true, deletedAt: null },
          usersWorkspaceMembersUserIdTousers: { isActive: true, deletedAt: null },
        },
        select: membershipSelect,
        orderBy: { createdAt: "asc" },
      }),
      this.database.userPreference.findUnique({
        where: { userId },
        select: { defaultWorkspaceId: true },
      }),
    ]);
    return memberships.map((membership) => ({
      ...toContext(membership),
      isDefault: membership.workspaceId === preference?.defaultWorkspaceId,
    }));
  }
  resolve(userId: string, workspaceId: string) {
    return resolveMembership(userId, workspaceId, this.database);
  }
  async getDefaultWorkspaceId(userId: string) {
    return (
      await this.database.userPreference.findUnique({
        where: { userId },
        select: { defaultWorkspaceId: true },
      })
    )?.defaultWorkspaceId;
  }
  async select(userId: string, workspaceId: string) {
    return withTransactionRetry(() =>
      this.database.$transaction(
        async (tx) => {
          const membership = await tx.workspaceMember.findFirst({
            where: {
              userId,
              workspaceId,
              status: "ACTIVE",
              workspaces: { isActive: true, deletedAt: null },
              usersWorkspaceMembersUserIdTousers: { isActive: true, deletedAt: null },
            },
            select: membershipSelect,
          });
          if (!membership) throw workspaceNotFound();
          const preferences = await tx.userPreference.update({
            where: { userId },
            data: { defaultWorkspaceId: workspaceId },
            select: { defaultWorkspaceId: true, updatedAt: true },
          });
          return { context: toContext(membership), preferences };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}

export const workspacesRepository = new WorkspacesRepository();
