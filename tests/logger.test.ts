import { describe, expect, it } from "vitest";
import { createLogEntry, sanitizeForLogging } from "../src/common/logging/logger.js";

describe("sanitización de logs", () => {
  it("oculta claves sensibles anidadas sin modificar el original", () => {
    const original = {
      user: {
        password: "one",
        passwordHash: "two",
        profile: { DATABASE_URL: "three", clientSecret: "four" },
      },
      sessions: [{ accessToken: "five", refresh_token: "six" }],
      headers: { Authorization: "seven", Cookie: "eight", "Set-Cookie": "nine" },
      safe: "visible",
    };
    const sanitized = sanitizeForLogging(original);
    expect(JSON.stringify(sanitized)).not.toMatch(/one|two|three|four|five|six|seven|eight|nine/);
    expect((sanitized as Record<string, unknown>).safe).toBe("visible");
    expect(original.user.password).toBe("one");
  });
  it("tolera referencias circulares", () => {
    const value: { token: string; self?: unknown } = { token: "hidden" };
    value.self = value;
    expect(sanitizeForLogging(value)).toEqual({ token: "[REDACTED]", self: "[Circular]" });
  });
  it("impide que el contexto sobrescriba los campos canónicos", () => {
    const entry = createLogEntry("info", "mensaje interno", {
      level: "error",
      message: "mensaje externo",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("mensaje interno");
    expect(entry.timestamp).not.toBe("1970-01-01T00:00:00.000Z");
    expect(entry.context).toEqual({
      level: "error",
      message: "mensaje externo",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
  });
});
