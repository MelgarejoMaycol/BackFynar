import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { requireIsolatedTestDatabase } from "./test-database-guard.js";

const databaseUrl = requireIsolatedTestDatabase(process.env);
const args = process.argv.slice(2);
if (args.length === 0) throw new Error("Falta el comando Prisma para la base de test");
const result = spawnSync(
  process.execPath,
  [resolve("node_modules/prisma/build/index.js"), ...args],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  },
);
process.exit(result.status ?? 1);
