import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import { GoogleOAuthService } from "../src/modules/auth/google-oauth.service.js";

const original = {
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  callbackUrl: env.GOOGLE_CALLBACK_URL,
};

afterEach(() => {
  env.GOOGLE_CLIENT_ID = original.clientId;
  env.GOOGLE_CLIENT_SECRET = original.clientSecret;
  env.GOOGLE_CALLBACK_URL = original.callbackUrl;
  vi.restoreAllMocks();
});

describe("GoogleOAuthService", () => {
  it("devuelve un error controlado cuando Google no estÃ¡ configurado", async () => {
    env.GOOGLE_CLIENT_ID = undefined;
    env.GOOGLE_CLIENT_SECRET = undefined;
    env.GOOGLE_CALLBACK_URL = undefined;
    const service = new GoogleOAuthService({} as PrismaClient);
    await expect(service.authorizationUrl()).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_NOT_CONFIGURED",
      status: 503,
    });
  });

  it("genera state aleatorio y una URL OAuth con scopes mÃ­nimos", async () => {
    env.GOOGLE_CLIENT_ID = "client-id";
    env.GOOGLE_CLIENT_SECRET = "client-secret";
    env.GOOGLE_CALLBACK_URL = "http://localhost:3000/api/v1/auth/google/callback";
    const create = vi.fn().mockResolvedValue({ id: "flow" });
    const service = new GoogleOAuthService({
      googleOAuthFlow: { create },
    } as unknown as PrismaClient);

    const first = new URL(await service.authorizationUrl());
    const second = new URL(await service.authorizationUrl());
    expect(first.origin).toBe("https://accounts.google.com");
    expect(first.searchParams.get("redirect_uri")).toBe(env.GOOGLE_CALLBACK_URL);
    expect(first.searchParams.get("response_type")).toBe("code");
    expect(first.searchParams.get("scope")).toBe("openid email profile");
    expect(first.searchParams.get("state")).toBeTruthy();
    expect(first.searchParams.get("state")).not.toBe(second.searchParams.get("state"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0].data).not.toHaveProperty("state");
  });

  it("rechaza state desconocido y state reutilizado", async () => {
    env.GOOGLE_CLIENT_ID = "client-id";
    env.GOOGLE_CLIENT_SECRET = "client-secret";
    env.GOOGLE_CALLBACK_URL = "http://localhost:3000/api/v1/auth/google/callback";
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "flow",
        expiresAt: new Date(Date.now() + 60_000),
        stateConsumedAt: new Date(),
      });
    const service = new GoogleOAuthService({
      googleOAuthFlow: { findUnique },
    } as unknown as PrismaClient);
    await expect(service.consumeState("unknown")).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_STATE_INVALID",
    });
    await expect(service.consumeState("used")).rejects.toMatchObject({
      code: "GOOGLE_OAUTH_STATE_INVALID",
    });
  });
});
