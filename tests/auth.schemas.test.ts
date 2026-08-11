import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "../src/modules/auth/auth.schemas.js";

const validInput = {
  email: "persona@example.com",
  password: "frase segura",
  firstName: "María-José",
};

describe("schema de registro", () => {
  it("acepta y normaliza una entrada válida sin transformar la contraseña", () => {
    const parsed = registerSchema.parse({
      ...validInput,
      email: "  PERSONA@EXAMPLE.COM  ",
      password: "  frase segura con espacios  ",
      firstName: "  María-José  ",
      lastName: "  O'Neill Pérez  ",
    });
    expect(parsed).toEqual({
      email: "persona@example.com",
      password: "  frase segura con espacios  ",
      firstName: "María-José",
      lastName: "O'Neill Pérez",
    });
  });

  it.each(["", "correo-inválido", "@example.com"])("rechaza el correo inválido %j", (email) => {
    expect(registerSchema.safeParse({ ...validInput, email }).success).toBe(false);
  });

  it("rechaza contraseñas demasiado cortas o largas", () => {
    expect(registerSchema.safeParse({ ...validInput, password: "corta" }).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...validInput, password: "x".repeat(PASSWORD_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("acepta frases de contraseña con espacios internos", () => {
    expect(
      registerSchema.safeParse({ ...validInput, password: "una frase de contraseña" }).success,
    ).toBe(true);
  });

  it("rechaza firstName vacío y acepta Unicode", () => {
    expect(registerSchema.safeParse({ ...validInput, firstName: "   " }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validInput, firstName: "李 María" }).success).toBe(true);
  });

  it("acepta lastName ausente y convierte una cadena vacía en undefined", () => {
    expect(registerSchema.parse(validInput).lastName).toBeUndefined();
    expect(registerSchema.parse({ ...validInput, lastName: "   " }).lastName).toBeUndefined();
  });

  it.each(["role", "isActive", "passwordHash", "workspaceId", "provider"])(
    "rechaza el campo interno o desconocido %s",
    (field) => {
      expect(registerSchema.safeParse({ ...validInput, [field]: "no permitido" }).success).toBe(
        false,
      );
    },
  );
});

describe("schemas de sesion y recuperacion", () => {
  it("normaliza el email de login y rechaza propiedades desconocidas", () => {
    expect(loginSchema.parse({ email: " TEST@EXAMPLE.COM ", password: "secret" }).email).toBe(
      "test@example.com",
    );
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "secret", role: "OWNER" }).success,
    ).toBe(false);
  });
  it("rechaza tokens cortos y passwords de reset debiles", () => {
    expect(
      resetPasswordSchema.safeParse({ token: "x".repeat(32), newPassword: "short" }).success,
    ).toBe(false);
  });
});
