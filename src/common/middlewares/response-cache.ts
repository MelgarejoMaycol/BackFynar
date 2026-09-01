import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

interface CacheEntry {
  expiresAt: number;
  statusCode: number;
  body: unknown;
}

const CACHE_TTL_MS = 10_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

function credentialsFingerprint(request: Request): string | null {
  const authorization = request.get("authorization") ?? "";
  const cookie = request.get("cookie") ?? "";
  const identity = `${authorization}\n${cookie}`;

  if (!authorization && !cookie) return null;

  return createHash("sha256").update(identity).digest("hex");
}

function cacheKey(request: Request, fingerprint: string): string {
  return `${fingerprint}:${request.originalUrl}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function storeEntry(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, entry);
}

/**
 * Cache privada y de vida corta para lecturas autenticadas de workspaces.
 *
 * - Nunca comparte respuestas entre usuarios: la clave usa un hash de sus credenciales.
 * - Cualquier mutación invalida inmediatamente todo el cache del proceso.
 * - No cachea autenticación, health checks ni respuestas con Set-Cookie.
 * - El TTL corto evita mantener datos financieros antiguos durante demasiado tiempo.
 * - Se desactiva en pruebas para que el estado en memoria no contamine casos de integración.
 */
export function privateResponseCache(request: Request, response: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }

  if (request.method !== "GET") {
    if (cache.size > 0) cache.clear();
    next();
    return;
  }

  if (!request.path.startsWith("/api/v1/workspaces/")) {
    next();
    return;
  }

  const fingerprint = credentialsFingerprint(request);
  if (!fingerprint) {
    next();
    return;
  }

  const now = Date.now();
  pruneExpired(now);

  const key = cacheKey(request, fingerprint);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    response.setHeader("X-Fynar-Cache", "HIT");
    response.status(cached.statusCode).json(cached.body);
    return;
  }

  response.setHeader("X-Fynar-Cache", "MISS");
  const originalJson = response.json.bind(response);

  response.json = ((body: unknown) => {
    if (response.statusCode === 200 && response.getHeader("set-cookie") === undefined) {
      storeEntry(key, {
        body,
        statusCode: response.statusCode,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
    return originalJson(body);
  }) as Response["json"];

  next();
}
