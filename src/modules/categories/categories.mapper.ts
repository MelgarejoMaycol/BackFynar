import { Prisma } from "@prisma/client";

export const categorySelect = Prisma.validator<Prisma.CategorySelect>()({
  id: true,
  parentId: true,
  name: true,
  type: true,
  icon: true,
  color: true,
  isSystem: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

export const toPublicCategory = (category: CategoryRecord) => ({
  id: category.id,
  parentId: category.parentId,
  name: category.name,
  type: category.type,
  icon: category.icon,
  color: category.color,
  scope: category.isSystem ? ("SYSTEM" as const) : ("CUSTOM" as const),
  isSystem: category.isSystem,
  isActive: category.isActive,
  createdAt: category.createdAt.toISOString(),
  updatedAt: category.updatedAt.toISOString(),
});
