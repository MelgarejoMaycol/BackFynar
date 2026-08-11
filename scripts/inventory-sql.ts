import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  process.argv[2],
  process.env.FYNAR_SQL_PATH,
  "../fynar_reset_y_recrear.sql",
  "../../fynar_reset_y_recrear.sql",
]
  .filter((path): path is string => Boolean(path))
  .map((path) => resolve(path));
const sqlPath = candidates.find(existsSync);
if (!sqlPath) {
  throw new Error(
    'No se encontró el SQL. Proporcione la ruta con: npm run sql:inventory -- "../fynar_reset_y_recrear.sql" o defina FYNAR_SQL_PATH.',
  );
}
const sql = readFileSync(sqlPath, "utf8");
const count = (pattern: RegExp): number => [...sql.matchAll(pattern)].length;
const inventory = {
  tables: count(/^CREATE TABLE\s+/gim),
  enums: count(/^CREATE TYPE\s+\w+\s+AS ENUM/gim),
  explicitIndexes: count(/^CREATE (?:UNIQUE )?INDEX\s+/gim),
  triggers: count(/^CREATE TRIGGER\s+/gim),
  extensions: count(/^CREATE EXTENSION\s+/gim),
};
console.log(JSON.stringify(inventory, null, 2));
