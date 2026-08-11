import "dotenv/config";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== "test") throw new Error("test:integration exige NODE_ENV=test");
if (process.env.ALLOW_DATABASE_TESTS !== "true")
  throw new Error("test:integration exige ALLOW_DATABASE_TESTS=true");
if (!url) throw new Error("test:integration exige DATABASE_URL");
const database = new URL(url).pathname.replace(/^\//, "");
const isolatedTestDatabase = /(^|[_-])(test|testing)([_-]|$)/i.test(database);
const explicitlyAuthorizedSharedDevelopmentDatabase =
  database === "neondb" && process.env.ALLOW_SHARED_DEV_DATABASE_TESTS === "true";
if (!isolatedTestDatabase && !explicitlyAuthorizedSharedDevelopmentDatabase)
  throw new Error("DATABASE_URL debe ser test/testing o tener autorización compartida explícita");
const result = spawnSync(
  process.execPath,
  [resolve("node_modules/vitest/vitest.mjs"), "run", "tests/integration", "--no-file-parallelism"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
