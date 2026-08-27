import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logging/logger.js";
import { sanitizeForLogging } from "../logging/logger.js";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { captureServerException } from "../observability/sentry.js";

interface ParserError extends Error {
  type?: string;
  code?: string;
}
const asParserError = (error: unknown): ParserError | null =>
  error instanceof Error ? (error as ParserError) : null;
const prismaErrorResponse = (error: unknown, path: string) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as { modelName?: string; target?: unknown } | undefined;
  const accountNameConflict =
    meta?.modelName === "FinancialAccount" &&
    Array.isArray(meta.target) &&
    meta.target.includes("name");
  switch (error.code) {
    case "P2002":
      return {
        status: 409,
        code: "RESOURCE_ALREADY_EXISTS",
        message:
          accountNameConflict || path.endsWith("/cards")
            ? "Ya existe una cuenta o tarjeta con ese nombre"
            : "Ya existe un recurso con esos datos",
      };
    case "P2003":
      return {
        status: 409,
        code: "RELATED_RESOURCE_CONFLICT",
        message: "El recurso relacionado no existe o está siendo utilizado",
      };
    case "P2000":
    case "P2004":
    case "P2011":
    case "P2014":
      return {
        status: 400,
        code: "DATABASE_CONSTRAINT_ERROR",
        message: "Los datos no cumplen las restricciones requeridas",
      };
    case "P2025":
      return {
        status: 404,
        code: "RESOURCE_NOT_FOUND",
        message: "El recurso solicitado no existe",
      };
    default:
      return null;
  }
};

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
  const prismaResponse = prismaErrorResponse(error, request.path);
  const knownPrismaError = error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
  logger.error("Solicitud fallida", {
    requestId: request.requestId,
    errorName: parserError?.name,
    errorCode: parserError?.code,
    path: request.path,
    method: request.method,
    errorMessage: env.NODE_ENV === "development" ? parserError?.message : undefined,
    prismaCode: knownPrismaError?.code,
    prismaMeta: knownPrismaError ? sanitizeForLogging(knownPrismaError.meta) : undefined,
    validation:
      error instanceof AppError && error.code === "VALIDATION_ERROR"
        ? sanitizeForLogging(error.details)
        : undefined,
  });
  const status = invalidJson
    ? 400
    : payloadTooLarge
      ? 413
      : prismaResponse
        ? prismaResponse.status
        : error instanceof AppError
          ? error.status
          : 500;
  if (status >= 500) {
    captureServerException(error, {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
    });
  }
  response.status(status).json({
    success: false,
    error: {
      code: invalidJson
        ? "INVALID_JSON"
        : payloadTooLarge
          ? "PAYLOAD_TOO_LARGE"
          : prismaResponse
            ? prismaResponse.code
            : error instanceof AppError
              ? error.code
              : "INTERNAL_ERROR",
      message: invalidJson
        ? "El cuerpo JSON de la solicitud no es válido"
        : payloadTooLarge
          ? "El cuerpo de la solicitud supera el límite permitido"
          : prismaResponse
            ? prismaResponse.message
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
