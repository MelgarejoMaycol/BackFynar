import { describe, expect, it } from "vitest";
import { requireIsolatedTestDatabase } from "../scripts/test-database-guard.js";

const safeEnvironment = {
  NODE_ENV: "test",
  ALLOW_DATABASE_TESTS: "true",
  DATABASE_URL_TEST: "postgresql://fynar:secret@127.0.0.1:5432/fynar_test",
};

describe("protección de base de integración", () => {
  it("acepta exclusivamente una base local identificada como test", () => {
    expect(requireIsolatedTestDatabase(safeEnvironment)).toBe(safeEnvironment.DATABASE_URL_TEST);
  });

  it.each([
    [{ ...safeEnvironment, NODE_ENV: "production" }],
    [{ ...safeEnvironment, ALLOW_DATABASE_TESTS: "false" }],
    [{ ...safeEnvironment, DATABASE_URL_TEST: undefined }],
    [{ ...safeEnvironment, DATABASE_URL_TEST: "postgresql://u:p@localhost:5432/fynar" }],
    [{ ...safeEnvironment, DATABASE_URL_TEST: "postgresql://u:p@example.com/fynar_test" }],
    [{ ...safeEnvironment, DATABASE_URL_TEST: "postgresql://u:p@ep.neon.tech/fynar_test" }],
  ])("rechaza una configuración peligrosa", (environment) => {
    expect(() => requireIsolatedTestDatabase(environment)).toThrow();
  });
});
