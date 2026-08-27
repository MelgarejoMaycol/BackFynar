import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { requireIsolatedTestDatabase } from "./test-database-guard.js";

const databaseUrl = "postgresql://fynar_test:fynar_test_password@127.0.0.1:5434/fynar_test";
const environment = {
  ...process.env,
  NODE_ENV: "test",
  ALLOW_DATABASE_TESTS: "true",
  DATABASE_URL_TEST: databaseUrl,
  DATABASE_URL: databaseUrl,
  EMAIL_PROVIDER: "console",
  RESEND_API_KEY: "",
  BREVO_API_KEY: "",
};

requireIsolatedTestDatabase(environment);
const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) throw new Error("Falta el comando QA");

const executables: Record<string, string[]> = {
  prisma: [resolve("node_modules/prisma/build/index.js")],
  integration: [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    ...(args.length > 0 ? args : ["tests/integration"]),
    "--no-file-parallelism",
  ],
  seed: [resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"],
  verify: [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/verify-database-schema.ts"],
  e2eSeed: [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/seed-e2e.ts"],
  server: [resolve("node_modules/tsx/dist/cli.mjs"), "src/server.ts"],
};
const selected = executables[command];
if (!selected) throw new Error(`Comando QA no permitido: ${command}`);

const result = spawnSync(
  process.execPath,
  command === "integration" ? selected : [...selected, ...args],
  {
    stdio: "inherit",
    env: environment,
  },
);
process.exit(result.status ?? 1);
