import "dotenv/config";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { requireIsolatedTestDatabase } from "./test-database-guard.js";

const databaseUrl = requireIsolatedTestDatabase(process.env);
const result = spawnSync(
  process.execPath,
  [resolve("node_modules/vitest/vitest.mjs"), "run", "tests/integration", "--no-file-parallelism"],
  { stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl } },
);
process.exit(result.status ?? 1);
