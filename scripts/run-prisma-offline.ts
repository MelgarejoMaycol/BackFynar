import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const command = process.argv[2];
if (command !== "validate" && command !== "generate") {
  throw new Error("Este script admite únicamente prisma validate o prisma generate");
}

const environment = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:1/veloryx_placeholder",
};
// Prisma 6.19 expone actualmente este entrypoint del CLI. Revisar esta ruta interna
// antes de actualizar Prisma; no es parte de su API pública estable.
const prismaCli = resolve("node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, command], {
  stdio: "inherit",
  env: environment,
});
process.exit(result.status ?? 1);
