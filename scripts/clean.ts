import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const targets = [
  "dist",
  "coverage",
  ...readdirSync(projectRoot).filter((name) => name.startsWith(".clean-validation-")),
];

for (const relativePath of targets) {
  const target = resolve(projectRoot, relativePath);
  if (!target.startsWith(`${projectRoot}\\`) && !target.startsWith(`${projectRoot}/`)) {
    throw new Error(`Se rechazó una ruta de limpieza fuera del proyecto: ${relativePath}`);
  }
  rmSync(target, { recursive: true, force: true });
}

console.log(JSON.stringify({ cleaned: targets }));
