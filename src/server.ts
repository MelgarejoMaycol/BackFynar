import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./database/prisma.js";
import { logger } from "./common/logging/logger.js";
import { markApplicationShuttingDown } from "./common/lifecycle/application-lifecycle.js";
import { captureServerException } from "./common/observability/sentry.js";

const PORT = env.PORT;

const applyProductionMigrations = (): void => {
  if (env.NODE_ENV !== "production") return;

  const prismaCli = resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
  logger.info("Aplicando migraciones de base de datos antes de iniciar el servidor");

  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error || result.status !== 0) {
    logger.error("No fue posible aplicar las migraciones de producción", {
      errorName: result.error?.name,
      errorCode: result.error && "code" in result.error ? result.error.code : undefined,
      exitCode: result.status,
      signal: result.signal,
    });
    process.exit(result.status ?? 1);
  }

  logger.info("Migraciones de producción aplicadas correctamente");
};

applyProductionMigrations();

const server = app.listen(PORT, () => {
  logger.info("Servidor iniciado", {
    environment: env.NODE_ENV,
    port: PORT,
    apiPrefix: env.API_PREFIX,
    apiVersion: env.API_VERSION,
  });
});

let isShuttingDown = false;
let prismaDisconnectPromise: Promise<void> | undefined;
const disconnectPrisma = (): Promise<void> => {
  if (prismaDisconnectPromise) return prismaDisconnectPromise;
  const disconnectPromise = prisma.$disconnect();
  prismaDisconnectPromise = disconnectPromise;
  return disconnectPromise;
};
const errorContext = (error: unknown): Record<string, unknown> =>
  error instanceof Error
    ? { errorName: error.name, errorCode: "code" in error ? error.code : undefined }
    : { errorName: "Unknown" };
const shutdown = (signal: string, exitCode = 0): void => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  markApplicationShuttingDown();
  logger.info("Iniciando apagado controlado", { signal });
  const forceTimer = setTimeout(async () => {
    logger.error("Cierre forzado por timeout", { signal });
    server.closeAllConnections?.();
    try {
      await Promise.race([
        disconnectPrisma(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("PRISMA_DISCONNECT_TIMEOUT")), 1000),
        ),
      ]);
    } catch (error: unknown) {
      logger.error("Error al desconectar Prisma durante cierre forzado", errorContext(error));
    }
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close(async () => {
    try {
      await disconnectPrisma();
    } catch (error: unknown) {
      logger.error("Error al desconectar Prisma", errorContext(error));
      exitCode = 1;
    }
    clearTimeout(forceTimer);
    logger.info("Servidor cerrado correctamente");
    process.exit(exitCode);
  });
  server.closeIdleConnections?.();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Promesa rechazada no controlada", {
    errorName: reason instanceof Error ? reason.name : "Unknown",
  });
  captureServerException(reason);
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  logger.error("Excepción no controlada", errorContext(error));
  captureServerException(error);
  shutdown("uncaughtException", 1);
});
if (![env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_CALLBACK_URL].every(Boolean)) {
  logger.warn("Google OAuth no está configurado; el acceso con Google permanecerá deshabilitado");
}
