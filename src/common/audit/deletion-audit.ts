import { Prisma } from "@prisma/client";

export const recordDeletionAudit = (
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    userId: string;
    entityType: string;
    entityId: string;
    mode: "PHYSICAL" | "LOGICAL" | "CANCELLED";
    name?: string | null;
    dependencies?: Record<string, number>;
  },
) =>
  tx.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: "DELETE",
      oldData: {
        ...(input.name ? { name: input.name } : {}),
        mode: input.mode,
        ...(input.dependencies ? { dependencies: input.dependencies } : {}),
      } satisfies Prisma.InputJsonValue,
    },
  });
