import { describe, expect, it } from "vitest";
import {
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from "../src/modules/categories/categories.schemas.js";
import { normalizeCategoryName } from "../src/modules/categories/categories.service.js";

describe("contratos de categorías", () => {
  it("normaliza espacios sin perder la representación legible", () => {
    expect(normalizeCategoryName("  Comida   rápida  ")).toBe("Comida rápida");
  });

  it("acepta categoría principal y subcategoría", () => {
    expect(
      createCategorySchema.safeParse({
        name: "Alimentación",
        type: "EXPENSE",
        icon: "utensils",
        color: "#AABBCC",
      }).success,
    ).toBe(true);
    expect(
      createCategorySchema.safeParse({
        name: "Restaurantes",
        type: "EXPENSE",
        parentId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });

  it.each([
    { name: "X", type: "EXPENSE", workspaceId: "x" },
    { name: "X", type: "EXPENSE", isSystem: true },
    { name: "X", type: "EXPENSE", isActive: false },
    { name: "X", type: "EXPENSE", deletedAt: null },
    { name: "X", type: "OTHER" },
    { name: "X", type: "EXPENSE", icon: "<svg>" },
    { name: "X", type: "EXPENSE", color: "red" },
    { name: "X\nY", type: "EXPENSE" },
  ])("rechaza payload inválido %#", (payload) => {
    expect(createCategorySchema.safeParse(payload).success).toBe(false);
  });

  it("PATCH es parcial, estricto y no permite cambiar type", () => {
    expect(updateCategorySchema.safeParse({ icon: "shopping-bag", color: null }).success).toBe(
      true,
    );
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
    expect(updateCategorySchema.safeParse({ type: "INCOME" }).success).toBe(false);
  });

  it("limita el nombre al VARCHAR(100) real", () => {
    expect(createCategorySchema.safeParse({ name: "a".repeat(100), type: "EXPENSE" }).success).toBe(
      true,
    );
    expect(createCategorySchema.safeParse({ name: "a".repeat(101), type: "EXPENSE" }).success).toBe(
      false,
    );
  });

  it("valida filtros y combinaciones ambiguas", () => {
    expect(listCategoriesSchema.safeParse({ scope: "SYSTEM", type: "EXPENSE" }).success).toBe(true);
    expect(
      listCategoriesSchema.safeParse({ status: "ACTIVE", includeArchived: "true" }).success,
    ).toBe(false);
    expect(listCategoriesSchema.safeParse({ scope: "PRIVATE" }).success).toBe(false);
  });
});
