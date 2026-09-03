import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requirePermission } from "../src/modules/workspaces/workspace-context.js";

const response = {} as Response;
const ownerContext = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "user-1",
  roleId: "role-1",
  roleCode: "OWNER",
  permissions: ["accounts.read"],
  workspace: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "A",
    type: "PERSONAL" as const,
    baseCurrency: "COP",
    timezone: "America/Bogota",
    isActive: true,
  },
};

const memberContext = {
  ...ownerContext,
  roleId: "role-2",
  roleCode: "MEMBER",
};

describe("requirePermission", () => {
  it("continua cuando PostgreSQL resolvio el permiso", () => {
    const next = vi.fn();
    requirePermission("accounts.read")(
      { auth: { userId: "user-1", sessionId: "s" }, workspace: memberContext } as unknown as Request,
      response,
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("permite al OWNER aunque falte un permiso agregado recientemente", () => {
    for (const permission of ["goals.read", "goals.write", "unknown.permission"]) {
      const next = vi.fn();
      requirePermission(permission)(
        { auth: { userId: "user-1", sessionId: "s" }, workspace: ownerContext } as unknown as Request,
        response,
        next as NextFunction,
      );
      expect(next).toHaveBeenCalledWith();
    }
  });

  it("deniega a otros roles un permiso ausente o inexistente", () => {
    for (const permission of ["accounts.write", "unknown.permission"]) {
      const next = vi.fn();
      requirePermission(permission)(
        { auth: { userId: "user-1", sessionId: "s" }, workspace: memberContext } as unknown as Request,
        response,
        next as NextFunction,
      );
      expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403, code: "FORBIDDEN" });
    }
  });

  it("rechaza orden incorrecto sin auth o contexto", () => {
    const withoutAuth = vi.fn();
    requirePermission("accounts.read")(
      { workspace: ownerContext } as unknown as Request,
      response,
      withoutAuth as NextFunction,
    );
    expect(withoutAuth.mock.calls[0]?.[0]).toMatchObject({ status: 401 });
    const withoutWorkspace = vi.fn();
    requirePermission("accounts.read")(
      { auth: { userId: "u", sessionId: "s" } } as unknown as Request,
      response,
      withoutWorkspace as NextFunction,
    );
    expect(withoutWorkspace.mock.calls[0]?.[0]).toMatchObject({ status: 401 });
  });
});
