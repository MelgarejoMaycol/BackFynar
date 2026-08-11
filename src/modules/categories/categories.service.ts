import { Prisma, type category_type } from "@prisma/client";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../../common/errors/app-error.js";
import { toPublicCategory } from "./categories.mapper.js";
import { categoriesRepository, type CategoriesRepository } from "./categories.repository.js";
import type {
  CreateCategoryInput,
  ListCategoriesInput,
  UpdateCategoryInput,
} from "./categories.schemas.js";

const categoryNotFound = () =>
  new AppError("Categoría no encontrada en el workspace", {
    status: 404,
    code: "CATEGORY_NOT_FOUND",
    publicMessage: "Categoría no encontrada",
  });
const systemCategoryDenied = () =>
  new ForbiddenError(
    "Intento de modificación de categoría global",
    "Las categorías globales son de solo lectura",
  );
const duplicateCategory = () =>
  new ConflictError(
    "Colisión de categoría normalizada",
    "Ya existe una categoría con ese nombre en esta ubicación. Restaure la categoría anterior, utilice otro nombre o seleccione una categoría padre diferente.",
  );
const isUniqueConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function normalizeCategoryName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) throw new ValidationError("El nombre es obligatorio");
  if (normalized.length > 100)
    throw new ValidationError("El nombre no puede superar 100 caracteres");
  return normalized;
}

interface ParentCandidate {
  id: string;
  parentId: string | null;
  type: category_type;
  isActive: boolean;
  deletedAt: Date | null;
}

const validateParent = (
  parent: ParentCandidate | null,
  expectedType: category_type,
  categoryId?: string,
): void => {
  if (!parent) throw categoryNotFound();
  if (categoryId && parent.id === categoryId)
    throw new ConflictError("Una categoría no puede ser su propio padre");
  if (!parent.isActive || parent.deletedAt)
    throw new ConflictError("Categoría padre archivada", "La categoría padre está archivada");
  if (parent.parentId)
    throw new ConflictError(
      "Jerarquía de categorías mayor a un nivel",
      "Solo se permite un nivel de subcategorías",
    );
  if (parent.type !== expectedType)
    throw new ConflictError(
      "Tipo de padre incompatible",
      "La categoría y su padre deben tener el mismo tipo",
    );
};

export class CategoriesService {
  constructor(private readonly repository: CategoriesRepository = categoriesRepository) {}

  async list(workspaceId: string, filters: ListCategoriesInput) {
    return (await this.repository.list(workspaceId, filters)).map(toPublicCategory);
  }

  async get(workspaceId: string, categoryId: string) {
    const category = await this.repository.findVisible(workspaceId, categoryId);
    if (!category || category.deletedAt) throw categoryNotFound();
    return toPublicCategory(category);
  }

  async create(workspaceId: string, input: CreateCategoryInput) {
    try {
      return await this.repository.transaction(async (tx) => {
        if (input.parentId) {
          const parent = await this.repository.findVisible(workspaceId, input.parentId, tx);
          validateParent(parent, input.type);
        }
        return toPublicCategory(
          await this.repository.create(
            workspaceId,
            {
              name: normalizeCategoryName(input.name),
              type: input.type,
              parentId: input.parentId ?? null,
              ...(input.icon !== undefined ? { icon: input.icon } : {}),
              ...(input.color !== undefined ? { color: input.color?.toUpperCase() ?? null } : {}),
            },
            tx,
          ),
        );
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw duplicateCategory();
      throw error;
    }
  }

  async update(workspaceId: string, categoryId: string, input: UpdateCategoryInput) {
    try {
      return await this.repository.transaction(async (tx) => {
        const current = await this.repository.findVisible(workspaceId, categoryId, tx);
        if (!current) throw categoryNotFound();
        if (current.isSystem || current.workspaceId === null) throw systemCategoryDenied();
        if (current.deletedAt || !current.isActive)
          throw new ConflictError(
            "Edición de categoría archivada",
            "Restaure la categoría antes de editarla",
          );
        const parentId = input.parentId !== undefined ? input.parentId : current.parentId;
        if (parentId) {
          const parent = await this.repository.findVisible(workspaceId, parentId, tx);
          validateParent(parent, current.type, categoryId);
          if (
            input.parentId !== undefined &&
            (await this.repository.countActiveChildren(workspaceId, categoryId, tx)) > 0
          )
            throw new ConflictError(
              "Intento de crear una jerarquía de categorías de tres niveles",
              "No puede convertir esta categoría en subcategoría mientras tenga subcategorías activas. Reasigne o archive primero sus subcategorías.",
            );
        }
        const result = await this.repository.update(
          workspaceId,
          categoryId,
          {
            ...(input.name !== undefined ? { name: normalizeCategoryName(input.name) } : {}),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.icon !== undefined ? { icon: input.icon } : {}),
            ...(input.color !== undefined ? { color: input.color?.toUpperCase() ?? null } : {}),
          },
          tx,
        );
        if (result.count !== 1) throw categoryNotFound();
        const updated = await this.repository.findVisible(workspaceId, categoryId, tx);
        if (!updated) throw categoryNotFound();
        return toPublicCategory(updated);
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw duplicateCategory();
      throw error;
    }
  }

  async archive(workspaceId: string, categoryId: string): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const current = await this.repository.findVisible(workspaceId, categoryId, tx);
      if (!current) throw categoryNotFound();
      if (current.isSystem || current.workspaceId === null) throw systemCategoryDenied();
      if (current.deletedAt || !current.isActive) return;
      if ((await this.repository.countActiveChildren(workspaceId, categoryId, tx)) > 0)
        throw new ConflictError(
          "Categoría padre con hijos activos",
          "Archive o reasigne las subcategorías activas antes de archivar esta categoría",
        );
      await this.repository.update(
        workspaceId,
        categoryId,
        { isActive: false, deletedAt: new Date() },
        tx,
      );
    });
  }

  async restore(workspaceId: string, categoryId: string) {
    try {
      return await this.repository.transaction(async (tx) => {
        const current = await this.repository.findVisible(workspaceId, categoryId, tx);
        if (!current) throw categoryNotFound();
        if (current.isSystem || current.workspaceId === null) throw systemCategoryDenied();
        if (current.isActive && !current.deletedAt) return toPublicCategory(current);
        if (current.parentId) {
          const parent = await this.repository.findVisible(workspaceId, current.parentId, tx);
          validateParent(parent, current.type, categoryId);
        }
        const result = await this.repository.update(
          workspaceId,
          categoryId,
          { isActive: true, deletedAt: null },
          tx,
        );
        if (result.count !== 1) throw categoryNotFound();
        const restored = await this.repository.findVisible(workspaceId, categoryId, tx);
        if (!restored) throw categoryNotFound();
        return toPublicCategory(restored);
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) throw duplicateCategory();
      throw error;
    }
  }
}

export const categoriesService = new CategoriesService();
