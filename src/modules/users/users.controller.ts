import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { clearRefreshCookie } from "../auth/auth-cookie.js";
import {
  deleteAccountSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from "./users.schemas.js";
import { usersService } from "./users.service.js";

const parse = <T>(schema: ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError("Datos invalidos", result.error.issues);
  return result.data;
};
const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };

export const getProfile = execute(async (request, response) => {
  response
    .status(200)
    .json({ success: true, data: await usersService.getProfile(request.auth!.userId) });
});
export const updateProfile = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await usersService.updateProfile(
      request.auth!.userId,
      parse(updateProfileSchema, request.body),
    ),
  });
});
export const updateAvatar = execute(async (request, response) => {
  if (!request.file) throw new ValidationError("Selecciona una imagen para continuar.");
  response.status(200).json({
    success: true,
    data: await usersService.updateAvatar(request.auth!.userId, request.file.buffer),
  });
});
export const getPreferences = execute(async (request, response) => {
  response
    .status(200)
    .json({ success: true, data: await usersService.getPreferences(request.auth!.userId) });
});
export const updatePreferences = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await usersService.updatePreferences(
      request.auth!.userId,
      parse(updatePreferencesSchema, request.body),
    ),
  });
});
export const deleteAccount = execute(async (request, response) => {
  await usersService.deleteAccount(request.auth!.userId, parse(deleteAccountSchema, request.body));
  clearRefreshCookie(response);
  response.status(204).send();
});
