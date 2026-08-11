import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { env } from "../src/config/env.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from "../src/modules/auth/auth-token.service.js";

describe("tokens de autenticacion", () => {
  it("firma y valida claims minimos", async () => {
    const token = await signAccessToken({ userId: "user-id", sessionId: "session-id" });
    await expect(verifyAccessToken(token)).resolves.toEqual({
      userId: "user-id",
      sessionId: "session-id",
    });
  });
  it("rechaza access tokens alterados", async () => {
    const token = await signAccessToken({ userId: "user-id", sessionId: "session-id" });
    const parts = token.split(".");
    const signature = parts[2]!;
    const alteredSignature = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
    await expect(
      verifyAccessToken(`${parts[0]}.${parts[1]}.${alteredSignature}`),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("rechaza access tokens expirados", async () => {
    const expired = await new SignJWT({ sid: "session-id" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setSubject("user-id")
      .setExpirationTime("0s")
      .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
    await expect(verifyAccessToken(expired)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("genera tokens opacos aleatorios y hashes deterministas", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    expect(first).not.toBe(second);
    expect(hashOpaqueToken(first)).toHaveLength(64);
    expect(hashOpaqueToken(first)).toBe(hashOpaqueToken(first));
    expect(hashOpaqueToken(first)).not.toBe(first);
  });
});
