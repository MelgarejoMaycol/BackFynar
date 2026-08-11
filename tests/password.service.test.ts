import { describe, expect, it } from "vitest";
import {
  createArgon2PasswordService,
  PasswordServiceInputError,
} from "../src/modules/auth/auth-password.service.js";
import type { PasswordHashDriver } from "../src/modules/auth/auth-password.service.js";
import {
  AUTH_PASSWORD_MEMORY_COST_MIN,
  AUTH_PASSWORD_PARALLELISM_MIN,
  AUTH_PASSWORD_TIME_COST_MIN,
} from "../src/config/auth-password.config.js";

const validConfig = {
  memoryCost: AUTH_PASSWORD_MEMORY_COST_MIN,
  timeCost: AUTH_PASSWORD_TIME_COST_MIN,
  parallelism: AUTH_PASSWORD_PARALLELISM_MIN,
};
const service = createArgon2PasswordService(validConfig);
const password = "Frase segura con espacios 2026";

describe("servicio de contraseñas Argon2id", () => {
  it("genera hashes Argon2id con sal automática y sin exponer la contraseña", async () => {
    const first = await service.hash(password);
    const second = await service.hash(password);
    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).not.toContain(password);
    expect(second).not.toBe(first);
  });

  it("verifica la contraseña correcta y rechaza otra", async () => {
    const hash = await service.hash(password);
    await expect(service.verify(hash, password)).resolves.toBe(true);
    await expect(service.verify(hash, "otra contraseña segura")).resolves.toBe(false);
  });

  it("rechaza entradas vacías o de tipo inválido sin reflejarlas", async () => {
    await expect(service.hash("")).rejects.toBeInstanceOf(PasswordServiceInputError);
    await expect(service.hash(null as unknown as string)).rejects.toBeInstanceOf(
      PasswordServiceInputError,
    );
    await expect(service.verify("", password)).rejects.toBeInstanceOf(PasswordServiceInputError);
  });

  it.each([
    ["parámetros incompletos", "$argon2id$v=19$m=19456$YWJj$YWJj"],
    ["Base64 inválido", "$argon2id$v=19$m=19456,t=2,p=1$***$***"],
    ["sal ausente", "$argon2id$v=19$m=19456,t=2,p=1$$YWJj"],
    ["hash ausente", "$argon2id$v=19$m=19456,t=2,p=1$YWJj$"],
    ["algoritmo distinto", "$argon2i$v=19$m=19456,t=2,p=1$YWJjZGVmZ2g$YWJj"],
  ])("devuelve false para un hash inválido: %s", async (_caseName, malformedHash) => {
    await expect(service.verify(malformedHash, password)).resolves.toBe(false);
  });

  it.each([
    [{ ...validConfig, memoryCost: AUTH_PASSWORD_MEMORY_COST_MIN - 1 }, "memoryCost"],
    [{ ...validConfig, timeCost: AUTH_PASSWORD_TIME_COST_MIN - 1 }, "timeCost"],
    [{ ...validConfig, parallelism: AUTH_PASSWORD_PARALLELISM_MIN - 1 }, "parallelism"],
    [{ ...validConfig, memoryCost: AUTH_PASSWORD_MEMORY_COST_MIN + 0.5 }, "decimal"],
    [{ ...validConfig, timeCost: Number.NaN }, "NaN"],
    [{ ...validConfig, parallelism: Number.POSITIVE_INFINITY }, "infinito"],
  ])("rechaza configuración criptográfica inválida: %s", (config) => {
    expect(() => createArgon2PasswordService(config)).toThrow(PasswordServiceInputError);
  });

  it("propaga errores internos no clasificados como formato inválido", async () => {
    const internalError = new Error("ARGON2_INTERNAL_FAILURE");
    const failingDriver: PasswordHashDriver = {
      hash: async () => {
        throw internalError;
      },
      verify: async () => {
        throw internalError;
      },
    };
    const failingService = createArgon2PasswordService(validConfig, failingDriver);
    await expect(failingService.hash(password)).rejects.toBe(internalError);
    await expect(failingService.verify("$argon2id$synthetic", password)).rejects.toBe(
      internalError,
    );
  });
});
