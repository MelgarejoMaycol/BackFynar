import { describe, expect, it, vi } from "vitest";
import { checkDatabase } from "../src/modules/health/health.service.js";

describe("readiness de PostgreSQL", () => {
  it("distingue base no configurada sin consultar Prisma", async () => {
    const client = { $queryRaw: vi.fn() };
    expect(await checkDatabase({ client, databaseUrl: undefined })).toEqual({
      ready: false,
      status: "unavailable",
      reason: "DATABASE_NOT_CONFIGURED",
    });
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });
  it("informa conexión correcta", async () => {
    const client = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    expect(await checkDatabase({ client, databaseUrl: "configured" })).toEqual({
      ready: true,
      status: "connected",
    });
  });
  it("oculta el rechazo interno de Prisma", async () => {
    const client = { $queryRaw: vi.fn().mockRejectedValue(new Error("password=super-secret")) };
    const result = await checkDatabase({ client, databaseUrl: "configured" });
    expect(result).toEqual({ ready: false, status: "unavailable", reason: "DATABASE_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });
  it("finaliza por timeout", async () => {
    const client = { $queryRaw: vi.fn(() => new Promise(() => {})) };
    const result = await checkDatabase({ client, databaseUrl: "configured", timeoutMs: 5 });
    expect(result).toEqual({ ready: false, status: "unavailable", reason: "DATABASE_UNAVAILABLE" });
  });
  it("rechaza readiness durante shutdown sin consultar Prisma", async () => {
    const client = { $queryRaw: vi.fn() };
    const result = await checkDatabase({
      client,
      databaseUrl: "configured",
      lifecycle: { isShuttingDown: () => true },
    });
    expect(result).toEqual({
      ready: false,
      status: "unavailable",
      reason: "APPLICATION_SHUTTING_DOWN",
    });
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });
});
