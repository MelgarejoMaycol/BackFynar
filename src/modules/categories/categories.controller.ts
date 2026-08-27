import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { categoriesService } from "./categories.service.js";
import {
  categoryIdSchema,
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from "./categories.schemas.js";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos inválidos", result.error.issues);
  return result.data;
};
const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
const categoryId = (request: Request) => parse(categoryIdSchema, request.params.categoryId);

export const list = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await categoriesService.list(
      request.workspace!.workspaceId,
      parse(listCategoriesSchema, request.query),
    ),
  });
});
export const get = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await categoriesService.get(request.workspace!.workspaceId, categoryId(request)),
  });
});
export const create = execute(async (request, response) => {
  response.status(201).json({
    success: true,
    data: await categoriesService.create(
      request.workspace!.workspaceId,
      parse(createCategorySchema, request.body),
    ),
  });
});
export const update = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await categoriesService.update(
      request.workspace!.workspaceId,
      categoryId(request),
      parse(updateCategorySchema, request.body),
    ),
  });
});
export const archive = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await categoriesService.archive(
      request.workspace!.workspaceId,
      request.auth!.userId,
      categoryId(request),
    ),
  });
});
export const restore = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await categoriesService.restore(request.workspace!.workspaceId, categoryId(request)),
  });
});
