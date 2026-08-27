export function requireIsolatedTestDatabase(environment: NodeJS.ProcessEnv): string {
  if (environment.NODE_ENV !== "test") throw new Error("Se exige NODE_ENV=test");
  if (environment.ALLOW_DATABASE_TESTS !== "true")
    throw new Error("Se exige ALLOW_DATABASE_TESTS=true");
  const rawUrl = environment.DATABASE_URL_TEST;
  if (!rawUrl) throw new Error("Se exige DATABASE_URL_TEST; DATABASE_URL no se acepta para QA");
  const url = new URL(rawUrl);
  const database = url.pathname.replace(/^\//, "");
  if (database !== "fynar_test")
    throw new Error("DATABASE_URL_TEST debe apuntar exactamente a la base fynar_test");
  if (!["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase()))
    throw new Error("Las pruebas destructivas solo pueden ejecutarse contra PostgreSQL local");
  return rawUrl;
}
