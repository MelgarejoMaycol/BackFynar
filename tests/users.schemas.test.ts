import { describe, expect, it } from "vitest";
import {
  deleteAccountSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from "../src/modules/users/users.schemas.js";

describe("eliminación de cuenta", () => {
  it("exige la frase exacta y no admite campos adicionales", () => {
    expect(deleteAccountSchema.safeParse({ confirmation: "ELIMINAR" }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirmation: "eliminar" }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirmation: "ELIMINAR", extra: true }).success).toBe(
      false,
    );
  });
});

describe("schemas de perfil", () => {
  it("acepta Unicode, trim y actualizacion parcial", () => {
    expect(updateProfileSchema.parse({ firstName: "  李 María  " })).toEqual({
      firstName: "李 María",
    });
  });
  it("acepta limpiar campos opcionales y valida telefono/avatar", () => {
    expect(updateProfileSchema.safeParse({ phone: null, avatarUrl: null }).success).toBe(true);
    expect(
      updateProfileSchema.safeParse({
        phone: "+57 300 123 4567",
        avatarUrl: "https://example.com/a.png",
      }).success,
    ).toBe(true);
    expect(
      updateProfileSchema.safeParse({ phone: "abc", avatarUrl: "javascript:bad" }).success,
    ).toBe(false);
  });
  it("rechaza body vacio y campos internos", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    for (const field of ["email", "isActive", "workspaceId", "passwordHash"])
      expect(updateProfileSchema.safeParse({ [field]: "forbidden" }).success).toBe(false);
  });
});

describe("schemas de preferencias", () => {
  it("acepta preferencias parciales validas", () => {
    expect(
      updatePreferencesSchema.safeParse({
        theme: "DARK",
        timezone: "America/Bogota",
        currency: "COP",
      }).success,
    ).toBe(true);
  });
  it("rechaza tema, timezone, campos y cuerpos invalidos", () => {
    expect(updatePreferencesSchema.safeParse({}).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ theme: "NEON" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ role: "OWNER" }).success).toBe(false);
  });
  it("limita dashboardLayout", () => {
    expect(updatePreferencesSchema.safeParse({ dashboardLayout: { widgets: ["a"] } }).success).toBe(
      true,
    );
    expect(
      updatePreferencesSchema.safeParse({ dashboardLayout: { value: "x".repeat(17_000) } }).success,
    ).toBe(false);
    expect(updatePreferencesSchema.safeParse({ dashboardLayout: ["not-an-object"] }).success).toBe(
      false,
    );
  });
});
