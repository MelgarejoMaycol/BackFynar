import { prisma } from "../../database/prisma.js";
export const findPublicRoles = () =>
  prisma.role.findMany({
    where: { isSystem: true },
    select: { code: true, name: true, description: true },
    orderBy: { code: "asc" },
  });
export const findSystemCategories = () =>
  prisma.category.findMany({
    where: { workspaceId: null, isSystem: true, isActive: true, deletedAt: null },
    select: { id: true, name: true, type: true, icon: true, color: true, parentId: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
