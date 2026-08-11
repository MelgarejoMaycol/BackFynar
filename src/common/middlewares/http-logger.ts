import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger.js";

export function httpLogger(request: Request, response: Response, next: NextFunction): void {
  const startedAt = performance.now();
  response.once("finish", () => {
    const path = request.originalUrl.split("?", 1)[0] ?? request.path;
    const context = {
      requestId: request.requestId,
      method: request.method,
      path,
      statusCode: response.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      ...(request.get("user-agent") ? { userAgent: request.get("user-agent") } : {}),
    };
    if (path.endsWith("/health/live")) logger.debug("Solicitud HTTP completada", context);
    else logger.info("Solicitud HTTP completada", context);
  });
  next();
}
