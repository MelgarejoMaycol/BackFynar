import { env } from "../../config/env.js";

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogContext = Record<string, unknown>;
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: unknown;
}

const levels: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = levels[env.LOG_LEVEL];
const sensitiveKeys = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "setcookie",
  "databaseurl",
  "secret",
  "clientsecret",
]);

export function sanitizeForLogging(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLogging(item, seen));
  const clean: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll(/[-_]/g, "");
    clean[key] = sensitiveKeys.has(normalizedKey)
      ? "[REDACTED]"
      : sanitizeForLogging(nestedValue, seen);
  }
  return clean;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (levels[level] > threshold) return;
  const output = JSON.stringify(createLogEntry(level, message, context));
  (level === "error" ? console.error : console.log)(output);
}

export function createLogEntry(
  level: LogLevel,
  message: string,
  context: LogContext = {},
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: sanitizeForLogging(context),
  };
}

export const logger = {
  error: (message: string, context?: LogContext): void => write("error", message, context),
  warn: (message: string, context?: LogContext): void => write("warn", message, context),
  info: (message: string, context?: LogContext): void => write("info", message, context),
  debug: (message: string, context?: LogContext): void => write("debug", message, context),
};
