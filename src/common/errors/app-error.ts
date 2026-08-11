export interface AppErrorOptions {
  status?: number;
  code?: string;
  details?: unknown;
  safeToExpose?: boolean;
  publicMessage?: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly safeToExpose: boolean;
  readonly publicMessage: string | undefined;

  constructor(
    message: string,
    {
      status = 500,
      code = "INTERNAL_ERROR",
      details = null,
      safeToExpose = false,
      publicMessage,
    }: AppErrorOptions = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.safeToExpose = safeToExpose;
    this.publicMessage = publicMessage;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Datos inválidos", details: unknown = null) {
    super(message, {
      status: 400,
      code: "VALIDATION_ERROR",
      details,
      safeToExpose: true,
      publicMessage: message,
    });
  }
}
export class NotFoundError extends AppError {
  constructor(
    message = "El recurso solicitado no existe",
    publicMessage = "El recurso solicitado no existe",
  ) {
    super(message, { status: 404, code: "RESOURCE_NOT_FOUND", publicMessage });
  }
}
export class ConflictError extends AppError {
  constructor(message = "El recurso ya existe", publicMessage = "El recurso ya existe") {
    super(message, { status: 409, code: "CONFLICT", publicMessage });
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Autenticación requerida", publicMessage = "Autenticación requerida") {
    super(message, { status: 401, code: "UNAUTHORIZED", publicMessage });
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Acceso denegado", publicMessage = "Acceso denegado") {
    super(message, { status: 403, code: "FORBIDDEN", publicMessage });
  }
}
export class DatabaseError extends AppError {
  constructor(message = "No fue posible acceder a la base de datos", details: unknown = null) {
    super(message, {
      status: 503,
      code: "DATABASE_ERROR",
      details,
      publicMessage: "No fue posible acceder a la base de datos",
    });
  }
}
