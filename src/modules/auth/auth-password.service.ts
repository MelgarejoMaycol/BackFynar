import { argon2id, hash as createArgon2Hash, verify as verifyArgon2Hash } from "argon2";
import {
  AUTH_PASSWORD_MEMORY_COST_MIN,
  AUTH_PASSWORD_PARALLELISM_MIN,
  AUTH_PASSWORD_TIME_COST_MIN,
} from "../../config/auth-password.config.js";
import { env } from "../../config/env.js";

export interface PasswordService {
  hash(plainPassword: string): Promise<string>;
  verify(hash: string, plainPassword: string): Promise<boolean>;
}

export interface PasswordHashConfig {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export interface PasswordHashDriver {
  hash(
    plainPassword: string,
    options: {
      type: typeof argon2id;
      memoryCost: number;
      timeCost: number;
      parallelism: number;
      hashLength: number;
    },
  ): Promise<string>;
  verify(hash: string, plainPassword: string): Promise<boolean>;
}

export class PasswordServiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordServiceInputError";
  }
}

const ARGON2_HASH_LENGTH = 32;
const ARGON2ID_PHC_PREFIX = "$argon2id$";
const invalidArgon2HashMessages = new Set([
  "pchstr must contain a $ as first char",
  "params must be in the format name=value",
  "Output is too short",
  "Output pointer is NULL",
  "Salt is too short",
  "Decoding failed",
]);
const argon2Driver: PasswordHashDriver = {
  hash: (plainPassword, options) => createArgon2Hash(plainPassword, options),
  verify: (hash, plainPassword) => verifyArgon2Hash(hash, plainPassword),
};

function requireNonEmptyString(
  value: unknown,
  field: "password" | "hash",
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PasswordServiceInputError(
      field === "password" ? "La contraseña es obligatoria" : "El hash es obligatorio",
    );
  }
}

const isInvalidArgon2HashError = (error: unknown): boolean =>
  error instanceof Error && invalidArgon2HashMessages.has(error.message);

export function createArgon2PasswordService(
  config: PasswordHashConfig,
  driver: PasswordHashDriver = argon2Driver,
): PasswordService {
  if (
    !Number.isFinite(config.memoryCost) ||
    !Number.isFinite(config.timeCost) ||
    !Number.isFinite(config.parallelism) ||
    !Number.isInteger(config.memoryCost) ||
    !Number.isInteger(config.timeCost) ||
    !Number.isInteger(config.parallelism) ||
    config.memoryCost < AUTH_PASSWORD_MEMORY_COST_MIN ||
    config.timeCost < AUTH_PASSWORD_TIME_COST_MIN ||
    config.parallelism < AUTH_PASSWORD_PARALLELISM_MIN
  ) {
    throw new PasswordServiceInputError("La configuración de contraseñas no es válida");
  }
  return {
    async hash(plainPassword: string): Promise<string> {
      requireNonEmptyString(plainPassword, "password");
      return driver.hash(plainPassword, {
        type: argon2id,
        memoryCost: config.memoryCost,
        timeCost: config.timeCost,
        parallelism: config.parallelism,
        hashLength: ARGON2_HASH_LENGTH,
      });
    },
    async verify(hash: string, plainPassword: string): Promise<boolean> {
      requireNonEmptyString(hash, "hash");
      requireNonEmptyString(plainPassword, "password");
      if (!hash.startsWith(ARGON2ID_PHC_PREFIX)) return false;
      try {
        return await driver.verify(hash, plainPassword);
      } catch (error: unknown) {
        if (isInvalidArgon2HashError(error)) return false;
        throw error;
      }
    },
  };
}

export const passwordService = createArgon2PasswordService({
  memoryCost: env.AUTH_PASSWORD_MEMORY_COST,
  timeCost: env.AUTH_PASSWORD_TIME_COST,
  parallelism: env.AUTH_PASSWORD_PARALLELISM,
});
