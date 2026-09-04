import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../common/errors/app-error.js";
import { listNotificationsSchema, notificationIdSchema } from "./notifications.schemas.js";
import { notificationsService } from "./notifications.service.js";

const parseId = (value: unknown) => {
  const parsed = notificationIdSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError("notificationId inválido", parsed.error.issues);
  return parsed.data;
};

const asyncHandler =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };

const refreshInput = (request: Request) => ({
  workspaceId: request.workspace!.workspaceId,
  userId: request.auth!.userId,
  baseCurrency: request.workspace!.workspace.baseCurrency,
  timezone: request.workspace!.workspace.timezone,
  permissionContext: {
    roleCode: request.workspace!.roleCode,
    permissions: request.workspace!.permissions,
  },
});

export const list = asyncHandler(async (request, response) => {
  const filters = listNotificationsSchema.safeParse(request.query);
  if (!filters.success) throw new ValidationError("Filtros inválidos", filters.error.issues);
  response.json({
    success: true,
    data: await notificationsService.list(
      request.auth!.userId,
      request.workspace!.workspaceId,
      filters.data,
    ),
  });
});

export const summary = asyncHandler(async (request, response) => {
  response.json({
    success: true,
    data: await notificationsService.summary(
      request.auth!.userId,
      request.workspace!.workspaceId,
    ),
  });
});

export const refresh = asyncHandler(async (request, response) => {
  response.json({ success: true, data: await notificationsService.refresh(refreshInput(request)) });
});

export const markRead = asyncHandler(async (request, response) => {
  response.json({
    success: true,
    data: await notificationsService.markRead(
      request.auth!.userId,
      request.workspace!.workspaceId,
      parseId(request.params.notificationId),
    ),
  });
});

export const markAllRead = asyncHandler(async (request, response) => {
  response.json({
    success: true,
    data: await notificationsService.markAllRead(
      request.auth!.userId,
      request.workspace!.workspaceId,
    ),
  });
});

export const dismiss = asyncHandler(async (request, response) => {
  response.json({
    success: true,
    data: await notificationsService.dismiss(
      request.auth!.userId,
      request.workspace!.workspaceId,
      parseId(request.params.notificationId),
    ),
  });
});
