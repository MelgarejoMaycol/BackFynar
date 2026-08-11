import type { CookieOptions, Response } from "express";
import { env } from "../../config/env.js";

export const REFRESH_COOKIE_NAME = "veloryx_refresh_token";

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
