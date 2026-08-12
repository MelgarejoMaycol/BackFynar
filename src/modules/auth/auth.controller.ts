import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError, ValidationError } from "../../common/errors/app-error.js";
import { UnauthorizedError } from "../../common/errors/app-error.js";
import { authService } from "./auth.service.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  googleLegalAcceptanceSchema,
  requestEmailChangeSchema,
  confirmEmailChangeSchema,
} from "./auth.schemas.js";
import {
  clearGooglePendingCookie,
  clearRefreshCookie,
  GOOGLE_PENDING_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  setGooglePendingCookie,
  setRefreshCookie,
} from "./auth-cookie.js";
import { googleOAuthService } from "./google-oauth.service.js";
import { env } from "../../config/env.js";

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
  response.status(201).json({
    success: true,
    data: { user: result.user, verificationRequired: true },
  });
});
export const verifyEmail = execute(async (request, response) => {
  await authService.verifyEmail(parse(verifyEmailSchema, request.body).token);
  response.status(204).send();
});
export const resendVerification = execute(async (request, response) => {
  await authService.resendVerification(
    parse(resendVerificationSchema, request.body).email,
    metadata(request),
  );
  response
    .status(202)
    .json({
      success: true,
      data: { message: "Si la cuenta requiere verificación, enviaremos un correo" },
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
export const google = execute(async (_request, response) => {
  const destination = new URL("/auth/google/callback", env.APP_WEB_URL);
  try {
    response.redirect(302, await googleOAuthService.authorizationUrl());
  } catch (error: unknown) {
    destination.searchParams.set("status", "error");
    destination.searchParams.set(
      "code",
      error instanceof AppError ? error.code : "GOOGLE_OAUTH_CALLBACK_FAILED",
    );
    response.redirect(302, destination.toString());
  }
});
export const googleCallback = execute(async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  const destination = new URL("/auth/google/callback", env.APP_WEB_URL);
  try {
    const flowId = await googleOAuthService.consumeState(state);
    if (typeof request.query.error === "string")
      throw new AppError("Google canceló la autorización", {
        status: 400,
        code: "GOOGLE_OAUTH_CALLBACK_FAILED",
        safeToExpose: true,
      });
    const profile = await googleOAuthService.exchangeCode(code);
    try {
      const result = await authService.loginWithGoogle(profile, false, metadata(request));
      setRefreshCookie(response, result.tokens.refreshToken);
      destination.searchParams.set("status", "success");
    } catch (error: unknown) {
      if (!(error instanceof AppError) || error.code !== "LEGAL_ACCEPTANCE_REQUIRED") throw error;
      setGooglePendingCookie(response, await googleOAuthService.createPending(flowId, profile));
      destination.pathname = "/auth/google/legal";
    }
  } catch (error: unknown) {
    destination.searchParams.set("status", "error");
    destination.searchParams.set(
      "code",
      error instanceof AppError ? error.code : "GOOGLE_OAUTH_CALLBACK_FAILED",
    );
  }
  response.redirect(302, destination.toString());
});

export const completeGoogleRegistration = execute(async (request, response) => {
  parse(googleLegalAcceptanceSchema, request.body);
  const pendingToken = request.cookies[GOOGLE_PENDING_COOKIE_NAME] as unknown;
  if (typeof pendingToken !== "string" || !pendingToken)
    throw new AppError("Registro Google pendiente ausente", {
      status: 400,
      code: "GOOGLE_OAUTH_STATE_INVALID",
      safeToExpose: true,
    });
  try {
    const profile = await googleOAuthService.consumePending(pendingToken);
    const result = await authService.loginWithGoogle(profile, true, metadata(request));
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
  } finally {
    clearGooglePendingCookie(response);
  }
});
export const requestEmailChange = execute(async (request, response) => {
  const input = parse(requestEmailChangeSchema, request.body);
  response.status(202).json({ success: true, data: await authService.requestEmailChange(request.auth!.userId, input.newEmail, input.currentPassword, metadata(request)) });
});
export const confirmEmailChange = execute(async (request, response) => {
  await authService.confirmEmailChange(parse(confirmEmailChangeSchema, request.body).token);
  response.status(204).send();
});
export const getPendingEmailChange = execute(async (request, response) => {
  response.status(200).json({ success: true, data: await authService.getPendingEmailChange(request.auth!.userId) });
});
export const cancelEmailChange = execute(async (request, response) => {
  await authService.cancelEmailChange(request.auth!.userId);
  response.status(204).send();
});
