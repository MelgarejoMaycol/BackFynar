import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import { UnauthorizedError } from "../../common/errors/app-error.js";
import { authService } from "./auth.service.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "./auth.schemas.js";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "./auth-cookie.js";

const parse = <T>(schema: ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError("Datos invalidos", result.error.issues);
  return result.data;
};
const metadata = (request: Request) => {
  const userAgent = request.get("user-agent");
  const deviceName = request.get("x-device-name");
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(deviceName ? { deviceName } : {}),
  };
};
const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };

export const register = execute(async (request, response) => {
  const result = await authService.register(parse(registerSchema, request.body), metadata(request));
  setRefreshCookie(response, result.tokens.refreshToken);
  response.status(201).json({
    success: true,
    data: {
      user: result.user,
      tokens: {
        accessToken: result.tokens.accessToken,
        accessTokenExpiresInSeconds: result.tokens.accessTokenExpiresInSeconds,
      },
    },
  });
});
export const login = execute(async (request, response) => {
  const input = parse(loginSchema, request.body);
  const result = await authService.login(input.email, input.password, metadata(request));
  setRefreshCookie(response, result.tokens.refreshToken);
  response.status(200).json({
    success: true,
    data: {
      user: result.user,
      tokens: {
        accessToken: result.tokens.accessToken,
        accessTokenExpiresInSeconds: result.tokens.accessTokenExpiresInSeconds,
      },
    },
  });
});
export const refresh = execute(async (request, response) => {
  const refreshToken = request.cookies[REFRESH_COOKIE_NAME] as unknown;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    clearRefreshCookie(response);
    throw new UnauthorizedError("Refresh cookie ausente", "Sesion invalida");
  }
  try {
    const tokens = await authService.refresh(refreshToken, metadata(request));
    setRefreshCookie(response, tokens.refreshToken);
    response.status(200).json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        accessTokenExpiresInSeconds: tokens.accessTokenExpiresInSeconds,
      },
    });
  } catch (error: unknown) {
    clearRefreshCookie(response);
    throw error;
  }
});
export const logout = execute(async (request, response) => {
  const refreshToken = request.cookies[REFRESH_COOKIE_NAME] as unknown;
  try {
    if (typeof refreshToken === "string" && refreshToken.length > 0) {
      await authService.logout(refreshToken);
    }
  } finally {
    clearRefreshCookie(response);
  }
  response.status(204).send();
});
export const logoutAll = execute(async (request, response) => {
  try {
    await authService.logoutAll(request.auth!.userId);
  } finally {
    clearRefreshCookie(response);
  }
  response.status(204).send();
});
export const me = execute(async (request, response) => {
  response.status(200).json({ success: true, data: await authService.me(request.auth!.userId) });
});
export const forgotPassword = execute(async (request, response) => {
  const input = parse(forgotPasswordSchema, request.body);
  await authService.forgotPassword(input.email, metadata(request));
  response
    .status(202)
    .json({ success: true, data: { message: "Si el correo existe, recibira instrucciones" } });
});
export const resetPassword = execute(async (request, response) => {
  const input = parse(resetPasswordSchema, request.body);
  await authService.resetPassword(input.token, input.newPassword);
  response.status(204).send();
});
export const changePassword = execute(async (request, response) => {
  const input = parse(changePasswordSchema, request.body);
  await authService.changePassword(
    request.auth!.userId,
    request.auth!.sessionId,
    input.currentPassword,
    input.newPassword,
  );
  response.status(204).send();
});
