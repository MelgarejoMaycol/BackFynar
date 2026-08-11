import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT, errors as joseErrors } from "jose";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/app-error.js";

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export const createOpaqueToken = (): string => randomBytes(32).toString("base64url");
export const hashOpaqueToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_MINUTES}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    if (!payload.sub || typeof payload.sid !== "string") throw new Error("JWT_CLAIMS_INVALID");
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (error: unknown) {
    if (
      error instanceof joseErrors.JOSEError ||
      (error instanceof Error && error.message === "JWT_CLAIMS_INVALID")
    ) {
      throw new UnauthorizedError("Access token invalido", "Token de acceso invalido o expirado");
    }
    throw error;
  }
}
