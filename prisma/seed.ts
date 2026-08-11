import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { logger } from "../src/common/logging/logger.js";
import { categoryPermissionsByRole, globalCategories, permissions, roles } from "./seed-data.js";

const prisma = new PrismaClient();

export async function seed(client: PrismaClient = prisma): Promise<void> {
  await client.$transaction(
    async (tx) => {
      for (const role of roles)
        await tx.role.upsert({ where: { code: role.code }, update: role, create: role });
      for (const permission of permissions)
        await tx.permission.upsert({
          where: { code: permission.code },
          update: permission,
          create: permission,
        });
      const owner = await tx.role.findUniqueOrThrow({ where: { code: "OWNER" } });
      const storedPermissions = await tx.permission.findMany({
        where: { code: { in: permissions.map(({ code }) => code) } },
      });
      await tx.rolePermission.createMany({
        data: storedPermissions.map(({ id }) => ({ roleId: owner.id, permissionId: id })),
        skipDuplicates: true,
      });
      const categoryPermissions = await tx.permission.findMany({
        where: { code: { in: ["categories.read", "categories.write"] } },
        select: { id: true, code: true },
      });
      const storedRoles = await tx.role.findMany({
        where: { code: { in: Object.keys(categoryPermissionsByRole) } },
        select: { id: true, code: true },
      });
      await tx.rolePermission.createMany({
        data: storedRoles.flatMap((role) => {
          const allowed = categoryPermissionsByRole[
            role.code as keyof typeof categoryPermissionsByRole
          ] as readonly string[];
          return categoryPermissions
            .filter((permission) => allowed.includes(permission.code))
            .map((permission) => ({ roleId: role.id, permissionId: permission.id }));
        }),
        skipDuplicates: true,
      });
      for (const category of globalCategories) {
        const existing = await tx.category.findFirst({
          where: {
            workspaceId: null,
            parentId: null,
            type: category.type,
            name: { equals: category.name, mode: "insensitive" },
          },
          select: { id: true },
        });
        const data = {
          ...category,
          workspaceId: null,
          parentId: null,
          isSystem: true,
          isActive: true,
          deletedAt: null,
        };
        if (existing) await tx.category.update({ where: { id: existing.id }, data });
        else await tx.category.create({ data });
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

const safeErrorContext = (error: unknown): Record<string, unknown> =>
  error instanceof Error
    ? { errorName: error.name, errorCode: "code" in error ? error.code : undefined }
    : { errorName: "Unknown" };

async function main(): Promise<void> {
  try {
    await seed();
    logger.info("Parámetros RBAC verificados correctamente");
  } catch (error: unknown) {
    logger.error("Falló el seed de parámetros RBAC", safeErrorContext(error));
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$disconnect();
    } catch (error: unknown) {
      logger.error("Falló la desconexión de Prisma después del seed", safeErrorContext(error));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
