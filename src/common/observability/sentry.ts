import * as Sentry from "@sentry/node";
import { env } from "../../config/env.js";
import { logger } from "../logging/logger.js";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.extra;
      delete event.contexts;
      delete event.breadcrumbs;
      return event;
    },
  });
} else if (env.NODE_ENV === "production") {
  logger.warn("Sentry no está configurado; la captura remota de errores está deshabilitada");
}

export const captureServerException = (
  error: unknown,
  context: { requestId?: string; method?: string; path?: string } = {},
): void => {
  if (!env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag("request_id", context.requestId);
    if (context.method) scope.setTag("http.method", context.method);
    if (context.path) scope.setTag("http.route", context.path);
    Sentry.captureException(error);
  });
};
