import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn().mockRejectedValue(new Error("connection refused with secret details")),
    role: {
      findMany: vi.fn().mockResolvedValue([
        {
          code: "OWNER",
          name: "Propietario",
          description: "Control total del espacio financiero",
        },
      ]),
    },
    category: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
import app from "../src/app.js";
import { logger } from "../src/common/logging/logger.js";

describe("infraestructura HTTP", () => {
  it("no confia en proxies por defecto", () => {
    expect(app.get("trust proxy")).toBe(false);
  });
  it("registra liveness en debug con el path completo y sin query", async () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    await request(app).get("/api/v1/health/live?token=no-debe-aparecer");
    expect(debug).toHaveBeenCalledWith(
      "Solicitud HTTP completada",
      expect.objectContaining({ path: "/api/v1/health/live" }),
    );
    expect(info).not.toHaveBeenCalledWith(
      "Solicitud HTTP completada",
      expect.objectContaining({ path: "/api/v1/health/live" }),
    );
    debug.mockRestore();
    info.mockRestore();
  });
  it("responde el health check con el contrato uniforme", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { apiVersion: "1.0.0" } });
    expect(["connected", "unavailable"]).toContain(response.body.data.database);
  });
  it("expone los parámetros públicos derivados del SQL", async () => {
    const response = await request(app).get("/api/v1/parameters");
    expect(response.status).toBe(200);
    expect(response.body.data.options.workspaceTypes).toEqual(["PERSONAL", "FAMILY", "BUSINESS"]);
    expect(response.body.data.defaults).toMatchObject({
      currency: "COP",
      locale: "es-CO",
      timezone: "America/Bogota",
      theme: "SYSTEM",
    });
  });
  it("normaliza rutas inexistentes", async () => {
    const response = await request(app).get("/api/v1/no-existe?token=secreto-no-exponer");
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: "ROUTE_NOT_FOUND",
      message: "La ruta solicitada no existe",
      details: null,
    });
    expect(JSON.stringify(response.body)).not.toContain("secreto-no-exponer");
  });
  it("diferencia liveness y readiness sin base", async () => {
    expect((await request(app).get("/api/v1/health/live")).status).toBe(200);
    const ready = await request(app).get("/api/v1/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body.data).toMatchObject({ ready: false, status: "unavailable" });
    expect(JSON.stringify(ready.body)).not.toContain("secret");
  });
  it("consulta roles y categorías globales", async () => {
    const roles = await request(app).get("/api/v1/roles");
    const categories = await request(app).get("/api/v1/categories/system");
    expect(roles.status).toBe(200);
    expect(roles.body.data[0].code).toBe("OWNER");
    expect(categories.status).toBe(200);
    expect(categories.body.data).toEqual([]);
  });
  it("responde 400 a JSON malformado sin exponer el parser", async () => {
    const response = await request(app)
      .post("/api/v1/parameters")
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: "INVALID_JSON",
      message: "El cuerpo JSON de la solicitud no es válido",
      details: null,
    });
    expect(JSON.stringify(response.body)).not.toContain("stack");
    expect(JSON.stringify(response.body)).not.toContain("Unexpected");
  });
  it("aplica la lista permitida de CORS", async () => {
    const allowed = await request(app)
      .get("/api/v1/health/live")
      .set("Origin", "http://localhost:5173");
    const denied = await request(app)
      .get("/api/v1/health/live")
      .set("Origin", "https://evil.example");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("CORS_ORIGIN_DENIED");
  });
  it("responde preflight para un origen permitido", async () => {
    const response = await request(app)
      .options("/api/v1/parameters")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "Content-Type,X-Request-Id");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("GET");
    expect(response.headers["access-control-allow-headers"]).toContain("X-Request-Id");
  });
  it("rechaza preflight para un origen no autorizado", async () => {
    const response = await request(app)
      .options("/api/v1/parameters")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CORS_ORIGIN_DENIED");
  });
  it("genera, reutiliza y reemplaza request IDs de forma segura", async () => {
    const generated = await request(app).get("/api/v1/parameters");
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const valid = "client-request_123";
    const reused = await request(app).get("/api/v1/parameters").set("X-Request-Id", valid);
    expect(reused.headers["x-request-id"]).toBe(valid);

    const invalid = await request(app)
      .get("/api/v1/parameters")
      .set("X-Request-Id", "bad id with spaces");
    expect(invalid.headers["x-request-id"]).not.toBe("bad id with spaces");
    expect(invalid.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("incluye requestId en el log HTTP estructurado", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await request(app).get("/api/v1/parameters").set("X-Request-Id", "log-request-123");
    const entries = log.mock.calls.map(
      ([value]) =>
        JSON.parse(String(value)) as { message?: string; context?: { requestId?: string } },
    );
    expect(
      entries.some(
        (entry) =>
          entry.message === "Solicitud HTTP completada" &&
          entry.context?.requestId === "log-request-123",
      ),
    ).toBe(true);
    log.mockRestore();
  });
  it("rechaza JSON mayor a 1 MB", async () => {
    const response = await request(app)
      .post("/api/v1/parameters")
      .send({ value: "x".repeat(1024 * 1024 + 1) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
