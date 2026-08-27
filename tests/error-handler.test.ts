import { describe, expect, it, vi } from "vitest";
import { AppError, DatabaseError, ValidationError } from "../src/common/errors/app-error.js";
import { errorHandler } from "../src/common/middlewares/error-handler.js";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";

describe("errores internos", () => {
  const invoke = (error: unknown, path = "/test") => {
    const json = vi.fn();
    const response = { status: vi.fn(() => ({ json })) };
    const request = {
      originalUrl: "/test",
      path,
      method: "GET",
      requestId: "request-test",
    } as Request;
    errorHandler(error, request, response as unknown as Response, vi.fn() as NextFunction);
    return { json, response };
  };

  it("conserva HTTP 500 sin stack ni mensaje interno", () => {
    const { json, response } = invoke(new Error("internal secret password=hidden"));
    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor", details: null },
    });
    expect(JSON.stringify(json.mock.calls)).not.toMatch(/password|hidden|stack/i);
  });

  it("expone únicamente detalles sanitizados de validación", () => {
    const { json, response } = invoke(
      new ValidationError("Entrada inválida", { field: "email", token: "secret" }),
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Entrada inválida",
        details: { field: "email", token: "[REDACTED]" },
      },
    });
  });

  it("no expone el mensaje interno de un AppError genérico", () => {
    const technical = invoke(
      new AppError("Prisma P2002 en índice users_email_key", {
        status: 409,
        code: "TECHNICAL",
        details: { sql: "SELECT secret" },
      }),
    );
    expect(technical.json).toHaveBeenCalledWith({
      success: false,
      error: { code: "TECHNICAL", message: "Error interno del servidor", details: null },
    });
    expect(JSON.stringify(technical.json.mock.calls)).not.toMatch(/Prisma|users_email_key|SELECT/i);
  });

  it("devuelve un publicMessage explícito", () => {
    const result = invoke(
      new AppError("Detalle técnico interno", {
        status: 409,
        code: "CONFLICT",
        publicMessage: "El recurso ya existe",
      }),
    );
    expect(result.json).toHaveBeenCalledWith({
      success: false,
      error: { code: "CONFLICT", message: "El recurso ya existe", details: null },
    });
  });

  it("DatabaseError conserva mensaje público y bloquea detalles", () => {
    const database = invoke(
      new DatabaseError("Prisma no pudo conectar a host-interno", {
        databaseUrl: "postgresql://secret",
      }),
    );
    expect(database.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "No fue posible acceder a la base de datos",
        details: null,
      },
    });
    expect(JSON.stringify(database.json.mock.calls)).not.toMatch(/Prisma|host-interno|postgresql/i);
  });
  it("traduce P2002 de tarjetas a 409 sin exponer el índice", () => {
    const result = invoke(
      new Prisma.PrismaClientKnownRequestError("Unique constraint workspace_id_name", {
        code: "P2002",
        clientVersion: "6.19.3",
        meta: { target: ["workspace_id", "name"] },
      }),
      "/api/v1/workspaces/workspace/cards",
    );
    expect(result.response.status).toHaveBeenCalledWith(409);
    expect(result.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "RESOURCE_ALREADY_EXISTS",
        message: "Ya existe una cuenta o tarjeta con ese nombre",
        details: null,
      },
    });
    expect(JSON.stringify(result.json.mock.calls)).not.toContain("workspace_id");
  });
  it.each([
    ["P2003", 409],
    ["P2011", 400],
    ["P2025", 404],
  ])("traduce %s a HTTP %s", (code, status) => {
    const result = invoke(
      new Prisma.PrismaClientKnownRequestError("technical constraint", {
        code,
        clientVersion: "6.19.3",
      }),
    );
    expect(result.response.status).toHaveBeenCalledWith(status);
    expect(JSON.stringify(result.json.mock.calls)).not.toContain("technical constraint");
  });
});
