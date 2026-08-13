import { prisma } from "../../database/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../common/logging/logger.js";
import {
  applicationLifecycle,
  type ApplicationLifecycle,
} from "../../common/lifecycle/application-lifecycle.js";

export type DatabaseStatus = "connected" | "unavailable";
export type ReadinessReason =
  "APPLICATION_SHUTTING_DOWN" | "DATABASE_NOT_CONFIGURED" | "DATABASE_UNAVAILABLE";
export interface Liveness {
  status: "ok";
  timestamp: string;
  uptime: number;
  environment: typeof env.NODE_ENV;
  apiVersion: string;
}
export type Readiness =
  | { ready: true; status: "connected" }
  | { ready: false; status: "unavailable"; reason: ReadinessReason };
export interface ReadinessDependencies {
  client?: DatabaseClient;
  databaseUrl?: string | undefined;
  timeoutMs?: number;
  lifecycle?: ApplicationLifecycle;
}
export interface DatabaseClient {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
}

const errorContext = (error: unknown): Record<string, unknown> =>
  error instanceof Error
    ? { errorName: error.name, errorCode: "code" in error ? error.code : undefined }
    : { errorName: "Unknown" };

export function getLiveness(): Liveness {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    apiVersion: env.API_VERSION,
  };
}

export async function checkDatabase(options: ReadinessDependencies = {}): Promise<Readiness> {
  const client = options.client ?? (prisma as DatabaseClient);
  const lifecycle = options.lifecycle ?? applicationLifecycle;
  const databaseUrl = Object.hasOwn(options, "databaseUrl")
    ? options.databaseUrl
    : env.DATABASE_URL;
  const timeoutMs = options.timeoutMs ?? env.DATABASE_HEALTH_TIMEOUT_MS;
  if (lifecycle.isShuttingDown())
    return { ready: false, status: "unavailable", reason: "APPLICATION_SHUTTING_DOWN" };
  if (!databaseUrl)
    return { ready: false, status: "unavailable", reason: "DATABASE_NOT_CONFIGURED" };
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DATABASE_HEALTH_TIMEOUT")), timeoutMs);
      }),
    ]);
    return { ready: true, status: "connected" };
  } catch (error: unknown) {
    logger.error("Falló la comprobación de PostgreSQL", errorContext(error));
    return { ready: false, status: "unavailable", reason: "DATABASE_UNAVAILABLE" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const getReadiness = (): Promise<Readiness> => checkDatabase();
export async function getHealth(): Promise<
  Omit<Liveness, "status"> & { status: "ok" | "degraded"; database: DatabaseStatus }
> {
  const database = await getReadiness();
  return {
    ...getLiveness(),
    status: database.ready ? "ok" : "degraded",
    database: database.status,
  };
}
