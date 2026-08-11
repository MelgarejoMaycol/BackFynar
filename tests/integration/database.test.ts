import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/database/prisma.js";
import { globalCategories, permissions, roles } from "../../prisma/seed-data.js";
import { seed } from "../../prisma/seed.js";

describe("PostgreSQL y seed real", () => {
  afterAll(() => prisma.$disconnect());
  it("conecta y mantiene el seed idempotente", async () => {
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeTruthy();
    await seed(prisma);
    await seed(prisma);
    expect(await prisma.role.count({ where: { code: { in: roles.map((x) => x.code) } } })).toBe(
      roles.length,
    );
    expect(
      await prisma.permission.count({ where: { code: { in: permissions.map((x) => x.code) } } }),
    ).toBe(permissions.length);
    const owner = await prisma.role.findUnique({
      where: { code: "OWNER" },
      include: { permissions: true },
    });
    if (!owner) throw new Error("OWNER no existe después del seed");
    const assigned = new Set(owner.permissions.map(({ permissionId }) => permissionId));
    const required = await prisma.permission.findMany({
      where: { code: { in: permissions.map(({ code }) => code) } },
    });
    expect(required.every(({ id }) => assigned.has(id))).toBe(true);
    for (const expected of roles) {
      expect(await prisma.role.findUnique({ where: { code: expected.code } })).toMatchObject({
        ...expected,
        isSystem: true,
      });
    }
    for (const expected of permissions)
      expect(await prisma.permission.findUnique({ where: { code: expected.code } })).toMatchObject(
        expected,
      );
    const duplicateRoles =
      await prisma.$queryRaw`SELECT code FROM roles GROUP BY code HAVING COUNT(*) > 1`;
    const duplicatePermissions =
      await prisma.$queryRaw`SELECT code FROM permissions GROUP BY code HAVING COUNT(*) > 1`;
    expect(duplicateRoles).toHaveLength(0);
    expect(duplicatePermissions).toHaveLength(0);
  }, 30_000);

  it("consulta modelos principales y relaciones reales", async () => {
    await expect(prisma.user.count()).resolves.toEqual(expect.any(Number));
    await expect(prisma.workspace.count()).resolves.toEqual(expect.any(Number));
    await expect(prisma.financialAccount.count()).resolves.toEqual(expect.any(Number));
    await expect(prisma.transaction.count()).resolves.toEqual(expect.any(Number));
    await expect(
      prisma.category.count({
        where: { workspaceId: null, isSystem: true, isActive: true, deletedAt: null },
      }),
    ).resolves.toBe(globalCategories.length);
    const owner = await prisma.role.findUniqueOrThrow({
      where: { code: "OWNER" },
      include: { permissions: { include: { permission: true } } },
    });
    expect(owner.permissions.map(({ permission }) => permission.code).sort()).toEqual(
      permissions.map(({ code }) => code).sort(),
    );
  });

  it("rechaza códigos de rol duplicados dentro de una transacción reversible", async () => {
    const code = `TEST_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.role.create({ data: { code, name: "Rol temporal de integración" } });
        await expect(
          tx.role.create({ data: { code, name: "Duplicado temporal" } }),
        ).rejects.toMatchObject({ code: "P2002" });
        throw new Error("ROLLBACK_INTEGRATION_TEST");
      }),
    ).rejects.toThrow("ROLLBACK_INTEGRATION_TEST");
    await expect(prisma.role.findUnique({ where: { code } })).resolves.toBeNull();
  });
});
