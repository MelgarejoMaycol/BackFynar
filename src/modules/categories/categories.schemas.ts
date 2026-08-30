import { category_type } from "@prisma/client";
import { z } from "zod";

const nameSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      }),
    "El nombre contiene caracteres inválidos",
  );
const iconSchema = z
  .union([
    z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    z.null(),
  ])
  .optional();
const colorSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/),
    z.null(),
  ])
  .optional();

export const createCategorySchema = z
  .object({
    name: nameSchema,
    type: z.nativeEnum(category_type),
    parentId: z.union([z.string().uuid(), z.null()]).optional(),
    icon: iconSchema,
    color: colorSchema,
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: nameSchema.optional(),
    parentId: z.union([z.string().uuid(), z.null()]).optional(),
    icon: iconSchema,
    color: colorSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Debe enviar al menos un campo");

export const categoryIdSchema = z.string().uuid();
export const listCategoriesSchema = z
  .object({
    type: z.nativeEnum(category_type).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
    parentId: z.string().uuid().optional(),
    scope: z.enum(["ALL", "SYSTEM", "CUSTOM"]).default("ALL"),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (value) => !(value.status && value.includeArchived === "true"),
    "No combine status con includeArchived=true",
  );

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesInput = z.infer<typeof listCategoriesSchema>;
