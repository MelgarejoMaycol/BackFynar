import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(projectRoot, "artifacts");
if (
  !artifactDirectory.startsWith(`${projectRoot}\\`) &&
  !artifactDirectory.startsWith(`${projectRoot}/`)
) {
  throw new Error("La carpeta de artefactos debe permanecer dentro del proyecto");
}

const included = [
  "src",
  "prisma",
  "scripts",
  "tests",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "eslint.config.js",
  "prisma.config.ts",
  "prettier.config.js",
  ".prettierignore",
  ".env.example",
  ".gitignore",
  "README_VELORYX.md",
] as const;
const stagingDirectory = mkdtempSync(join(tmpdir(), "veloryx-source-"));
const zipPath = join(artifactDirectory, "BackVeloryx-source.zip");

try {
  for (const relativePath of included) {
    const source = join(projectRoot, relativePath);
    if (!existsSync(source))
      throw new Error(`Falta un archivo requerido para empaquetar: ${relativePath}`);
    cpSync(source, join(stagingDirectory, basename(relativePath)), { recursive: true });
  }
  mkdirSync(artifactDirectory, { recursive: true });
  rmSync(zipPath, { force: true });
  const archive = spawnSync("tar", ["-a", "-c", "-f", zipPath, "-C", stagingDirectory, "."], {
    encoding: "utf8",
  });
  if (archive.status !== 0)
    throw new Error(`No fue posible crear el paquete: ${archive.stderr.trim()}`);

  const listing = spawnSync("tar", ["-t", "-f", zipPath], { encoding: "utf8" });
  if (listing.status !== 0)
    throw new Error(`No fue posible verificar el paquete: ${listing.stderr.trim()}`);
  const entries = listing.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter(Boolean);
  const forbidden = entries.filter(
    (entry) =>
      /(^|\/)(node_modules|dist|coverage|artifacts)(\/|$)/.test(entry) ||
      (/(^|\/)\.env(?:\..+)?$/.test(entry) && !entry.endsWith(".env.example")) ||
      /\.(?:log|tmp|bak)$/.test(entry) ||
      entry.endsWith("prisma/schema.introspected.prisma") ||
      /^(?:src|prisma|scripts|tests)\/.*\.js$/.test(entry),
  );
  if (forbidden.length > 0)
    throw new Error(`El paquete contiene rutas prohibidas: ${forbidden.join(", ")}`);
  for (const required of ["tsconfig.build.json", ".env.example", "README_VELORYX.md"]) {
    if (!entries.includes(required))
      throw new Error(`El paquete no contiene el archivo requerido: ${required}`);
  }
  console.log(
    JSON.stringify({
      package: "artifacts/BackVeloryx-source.zip",
      entries: entries.length,
      verified: true,
    }),
  );
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
