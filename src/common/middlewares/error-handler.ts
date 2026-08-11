import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logging/logger.js";
import { sanitizeForLogging } from "../logging/logger.js";

interface ParserError extends Error {
  type?: string;
  code?: string;
}
const asParserError = (error: unknown): ParserError | null =>
  error instanceof Error ? (error as ParserError) : null;

export function notFoundHandler(_request: Request, _response: Response, next: NextFunction): void {
  next(
    new AppError("La ruta solicitada no existe", {
      status: 404,
      code: "ROUTE_NOT_FOUND",
      publicMessage: "La ruta solicitada no existe",
    }),
  );
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
): void => {
  const parserError = asParserError(error);
  const payloadTooLarge = parserError?.type === "entity.too.large";
  const invalidJson = parserError?.type === "entity.parse.failed";
  logger.error("Solicitud fallida", {
    requestId: request.requestId,
    errorName: parserError?.name,
    errorCode: parserError?.code,
    path: request.path,
    method: request.method,
  });
  const status = invalidJson
    ? 400
    : payloadTooLarge
      ? 413
      : error instanceof AppError
        ? error.status
        : 500;
  response.status(status).json({
    success: false,
    error: {
      code: invalidJson
        ? "INVALID_JSON"
        : payloadTooLarge
          ? "PAYLOAD_TOO_LARGE"
          : error instanceof AppError
            ? error.code
            : "INTERNAL_ERROR",
      message: invalidJson
        ? "El cuerpo JSON de la solicitud no es válido"
        : payloadTooLarge
          ? "El cuerpo de la solicitud supera el límite permitido"
          : error instanceof AppError
            ? (error.publicMessage ?? "Error interno del servidor")
            : "Error interno del servidor",
      details:
        error instanceof AppError && error.safeToExpose && !payloadTooLarge && !invalidJson
          ? sanitizeForLogging(error.details)
          : null,
    },
  });
};
