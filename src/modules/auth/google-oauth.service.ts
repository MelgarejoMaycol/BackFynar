import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";
import { prisma } from "../../database/prisma.js";
import { hashOpaqueToken } from "./auth-token.service.js";
import type { GoogleProfile } from "./auth.service.js";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const FLOW_TTL_MS = 10 * 60 * 1_000;
const opaqueToken = () => randomBytes(32).toString("base64url");

const oauthError = (message: string, code: string, status = 400) =>
  new AppError(message, {
    status,
    code,
    safeToExpose: true,
    publicMessage: "No pudimos iniciar sesión con Google. Inténtalo nuevamente.",
  });

export class GoogleOAuthService {
  constructor(private readonly database: PrismaClient = prisma) {}

  get configured() {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL);
  }

  requireConfig() {
    if (!this.configured)
      throw oauthError("Google OAuth no configurado", "GOOGLE_OAUTH_NOT_CONFIGURED", 503);
  }

  async authorizationUrl() {
    this.requireConfig();
    const state = opaqueToken();
    await this.database.googleOAuthFlow.create({
      data: {
        stateHash: hashOpaqueToken(state),
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      },
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: env.GOOGLE_CALLBACK_URL!,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  async consumeState(state: string): Promise<string> {
    this.requireConfig();
    if (!state) throw oauthError("State ausente", "GOOGLE_OAUTH_STATE_INVALID");
    const now = new Date();
    const flow = await this.database.googleOAuthFlow.findUnique({
      where: { stateHash: hashOpaqueToken(state) },
      select: { id: true, expiresAt: true, stateConsumedAt: true },
    });
    if (!flow || flow.stateConsumedAt || flow.expiresAt <= now)
      throw oauthError("State inválido, vencido o reutilizado", "GOOGLE_OAUTH_STATE_INVALID");
    const consumed = await this.database.googleOAuthFlow.updateMany({
      where: { id: flow.id, stateConsumedAt: null, expiresAt: { gt: now } },
      data: { stateConsumedAt: now },
    });
    if (consumed.count !== 1) throw oauthError("State reutilizado", "GOOGLE_OAUTH_STATE_INVALID");
    return flow.id;
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    this.requireConfig();
    if (!code) throw oauthError("Código ausente", "GOOGLE_OAUTH_CALLBACK_FAILED");
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: env.GOOGLE_CALLBACK_URL!,
          grant_type: "authorization_code",
        }),
      });
    } catch {
      throw oauthError("Falló la conexión con Google", "GOOGLE_OAUTH_CALLBACK_FAILED", 502);
    }
    if (!response.ok)
      throw oauthError("Intercambio OAuth rechazado", "GOOGLE_OAUTH_CALLBACK_FAILED", 401);
    const payload = (await response.json()) as { id_token?: string };
    if (!payload.id_token)
      throw oauthError("ID token ausente", "GOOGLE_OAUTH_CALLBACK_FAILED", 401);
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(payload.id_token, googleKeys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: env.GOOGLE_CLIENT_ID!,
      }));
    } catch {
      throw oauthError("ID token inválido", "GOOGLE_OAUTH_CALLBACK_FAILED", 401);
    }
    if (typeof claims.sub !== "string" || typeof claims.email !== "string")
      throw oauthError("Claims incompletos", "GOOGLE_OAUTH_CALLBACK_FAILED", 401);
    if (claims.email_verified !== true)
      throw oauthError("Correo de Google no verificado", "GOOGLE_EMAIL_NOT_VERIFIED", 403);
    return {
      subject: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: true,
      firstName:
        typeof claims.given_name === "string" ? claims.given_name : claims.email.split("@")[0]!,
      ...(typeof claims.family_name === "string" ? { lastName: claims.family_name } : {}),
    };
  }

  async createPending(flowId: string, profile: GoogleProfile): Promise<string> {
    const token = opaqueToken();
    await this.database.googleOAuthFlow.update({
      where: { id: flowId },
      data: {
        pendingTokenHash: hashOpaqueToken(token),
        providerSubject: profile.subject,
        providerEmail: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName ?? null,
      },
    });
    return token;
  }

  async consumePending(token: string): Promise<GoogleProfile> {
    const now = new Date();
    const flow = await this.database.googleOAuthFlow.findUnique({
      where: { pendingTokenHash: hashOpaqueToken(token) },
    });
    if (
      !flow ||
      flow.completedAt ||
      flow.expiresAt <= now ||
      !flow.providerSubject ||
      !flow.providerEmail ||
      !flow.firstName
    )
      throw oauthError("Registro OAuth pendiente inválido", "GOOGLE_OAUTH_STATE_INVALID");
    const completed = await this.database.googleOAuthFlow.updateMany({
      where: { id: flow.id, completedAt: null, expiresAt: { gt: now } },
      data: { completedAt: now },
    });
    if (completed.count !== 1)
      throw oauthError("Registro OAuth pendiente reutilizado", "GOOGLE_OAUTH_STATE_INVALID");
    return {
      subject: flow.providerSubject,
      email: flow.providerEmail,
      emailVerified: true,
      firstName: flow.firstName,
      ...(flow.lastName ? { lastName: flow.lastName } : {}),
    };
  }
}

export const googleOAuthService = new GoogleOAuthService();
