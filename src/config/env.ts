import "dotenv/config";
import { z } from "zod";
import {
  AUTH_PASSWORD_MEMORY_COST_DEFAULT,
  AUTH_PASSWORD_MEMORY_COST_MAX,
  AUTH_PASSWORD_MEMORY_COST_MIN,
  AUTH_PASSWORD_PARALLELISM_DEFAULT,
  AUTH_PASSWORD_PARALLELISM_MAX,
  AUTH_PASSWORD_PARALLELISM_MIN,
  AUTH_PASSWORD_TIME_COST_DEFAULT,
  AUTH_PASSWORD_TIME_COST_MAX,
  AUTH_PASSWORD_TIME_COST_MIN,
} from "./auth-password.config.js";

const DEVELOPMENT_JWT_SECRET = "development-only-access-secret-change-me";
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z.string().startsWith("/").default("/api/v1"),
  API_VERSION: z.string().default("1.0.0"),
  DATABASE_URL: z.string().min(1).optional(),
  ALLOW_DEGRADED_START: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  REQUEST_BODY_LIMIT: z.string().default("64kb"),
  TRUST_PROXY: z
    .string()
    .regex(/^(false|loopback|[1-3])$/)
    .default("false"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  JWT_ACCESS_SECRET: z.string().min(32).default(DEVELOPMENT_JWT_SECRET),
  JWT_ISSUER: z.string().min(1).default("fynar-api"),
  JWT_AUDIENCE: z.string().min(1).default("fynar-clients"),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  CLOUDINARY_CLOUD_NAME: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  CLOUDINARY_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  CLOUDINARY_API_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  EMAIL_FROM: z.string().min(1).default("Fynar <no-reply@example.invalid>"),
  EMAIL_REPLY_TO: z.string().email().optional(),
  APP_WEB_URL: z.string().url().default("http://localhost:5173"),
  PASSWORD_RESET_PATH: z.string().startsWith("/").default("/reset-password"),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
  AUTH_PASSWORD_MEMORY_COST: z.coerce
    .number()
    .int()
    .min(AUTH_PASSWORD_MEMORY_COST_MIN)
    .max(AUTH_PASSWORD_MEMORY_COST_MAX)
    .default(AUTH_PASSWORD_MEMORY_COST_DEFAULT),
  AUTH_PASSWORD_TIME_COST: z.coerce
    .number()
    .int()
    .min(AUTH_PASSWORD_TIME_COST_MIN)
    .max(AUTH_PASSWORD_TIME_COST_MAX)
    .default(AUTH_PASSWORD_TIME_COST_DEFAULT),
  AUTH_PASSWORD_PARALLELISM: z.coerce
    .number()
    .int()
    .min(AUTH_PASSWORD_PARALLELISM_MIN)
    .max(AUTH_PASSWORD_PARALLELISM_MAX)
    .default(AUTH_PASSWORD_PARALLELISM_DEFAULT),
});

const runtimeEnvironment = {
  ...process.env,
  ...(process.env.RENDER === "true" ? { NODE_ENV: "production" } : {}),
};
const result = schema.safeParse(runtimeEnvironment);
if (!result.success) throw new Error(`Configuración inválida: ${z.prettifyError(result.error)}`);
export const env = result.data;
if (env.NODE_ENV === "production" && env.JWT_ACCESS_SECRET === DEVELOPMENT_JWT_SECRET)
  throw new Error("JWT_ACCESS_SECRET debe configurarse explicitamente en produccion");
if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY)
  throw new Error("RESEND_API_KEY es obligatoria cuando EMAIL_PROVIDER=resend");
if (env.NODE_ENV === "production" && !env.DATABASE_URL)
  throw new Error("DATABASE_URL es obligatoria en producción");
if (env.NODE_ENV === "development" && !env.DATABASE_URL && !env.ALLOW_DEGRADED_START) {
  throw new Error("Configure DATABASE_URL o habilite explícitamente ALLOW_DEGRADED_START=true");
}
const cloudinaryValues = [
  env.CLOUDINARY_CLOUD_NAME,
  env.CLOUDINARY_API_KEY,
  env.CLOUDINARY_API_SECRET,
];
if (cloudinaryValues.some(Boolean) && !cloudinaryValues.every(Boolean))
  throw new Error("Las tres credenciales de Cloudinary deben configurarse juntas");
export function requireDatabaseUrl() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL es obligatoria para acceder a PostgreSQL");
}
