import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.get("x-request-id");
  request.requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  response.setHeader("X-Request-Id", request.requestId);
  next();
}
