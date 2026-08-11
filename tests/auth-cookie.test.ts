import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import {
  clearRefreshCookie,
  createRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  setRefreshCookie,
} from "../src/modules/auth/auth-cookie.js";

describe("cookie de refresh", () => {
  it("usa alcance, expiración y protecciones centralizadas en desarrollo", () => {
    expect(REFRESH_COOKIE_NAME).toBe("veloryx_refresh_token");
    expect(refreshCookieOptions).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/api/v1/auth",
    });
    expect(refreshCookieOptions.maxAge).toBeGreaterThan(0);
  });

  it("establece y limpia la misma cookie mediante helpers compartidos", () => {
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const response = { cookie, clearCookie } as unknown as Response;

    setRefreshCookie(response, "token-secreto");
    clearRefreshCookie(response);

    expect(cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, "token-secreto", refreshCookieOptions);
    expect(clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/api/v1/auth",
      }),
    );
  });

  it("exige Secure y SameSite=None en producción HTTPS", () => {
    expect(createRefreshCookieOptions("production", "/api/v1", 30)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/api/v1/auth",
      maxAge: 30 * 24 * 60 * 60 * 1_000,
    });
  });
});
