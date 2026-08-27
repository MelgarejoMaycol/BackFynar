import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const suspicious = /(?:Ã|Â|â€|â€¦|�)/u;
const extensions = new Set([".ts", ".json"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extensions.has(extname(entry.name)) && entry.name !== "mojibake.test.ts"
      ? [path]
      : [];
  });
}

describe("codificación de textos visibles", () => {
  it("no contiene patrones comunes de mojibake en src", () => {
    const affected = sourceFiles(join(process.cwd(), "src")).filter((path) =>
      suspicious.test(readFileSync(path, "utf8")),
    );
    expect(affected).toEqual([]);
  });
});
