import type { CookieOptions, Response } from "express";
import { env } from "../../config/env.js";

export const REFRESH_COOKIE_NAME = "fynar_refresh_token";
export const GOOGLE_PENDING_COOKIE_NAME = "fynar_google_pending";

export const createRefreshCookieOptions = (
  nodeEnv: typeof env.NODE_ENV,
  apiPrefix: string,
  ttlDays: number,
): Readonly<CookieOptions> => {
  const production = nodeEnv === "production";
  return Object.freeze({
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    path: `${apiPrefix.replace(/\/$/, "")}/auth`,
    maxAge: ttlDays * 24 * 60 * 60 * 1_000,
  });
};

export const refreshCookieOptions = createRefreshCookieOptions(
  env.NODE_ENV,
  env.API_PREFIX,
  env.REFRESH_TOKEN_TTL_DAYS,
);

const clearCookieOptions: CookieOptions = {
  httpOnly: refreshCookieOptions.httpOnly,
  secure: refreshCookieOptions.secure,
  sameSite: refreshCookieOptions.sameSite,
  path: refreshCookieOptions.path,
};

export const setRefreshCookie = (response: Response, refreshToken: string): void => {
  response.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
};

export const clearRefreshCookie = (response: Response): void => {
  response.clearCookie(REFRESH_COOKIE_NAME, clearCookieOptions);
};

const googlePendingCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: refreshCookieOptions.secure,
  sameSite: refreshCookieOptions.sameSite,
  path: `${env.API_PREFIX.replace(/\/$/, "")}/auth/google`,
  maxAge: 10 * 60 * 1_000,
};

export const setGooglePendingCookie = (response: Response, token: string): void => {
  response.cookie(GOOGLE_PENDING_COOKIE_NAME, token, googlePendingCookieOptions);
};

export const clearGooglePendingCookie = (response: Response): void => {
  response.clearCookie(GOOGLE_PENDING_COOKIE_NAME, {
    httpOnly: true,
    secure: googlePendingCookieOptions.secure,
    sameSite: googlePendingCookieOptions.sameSite,
    path: googlePendingCookieOptions.path,
  });
};
