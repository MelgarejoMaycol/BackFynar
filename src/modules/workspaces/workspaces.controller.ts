import type { NextFunction, Request, Response } from "express";
import { workspacesService } from "./workspaces.service.js";

const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };
export const list = execute(async (request, response) => {
  response
    .status(200)
    .json({ success: true, data: await workspacesService.list(request.auth!.userId) });
});
export const get = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await workspacesService.get(request.auth!.userId, request.workspace!.workspaceId),
  });
});
export const select = execute(async (request, response) => {
  response.status(200).json({
    success: true,
    data: await workspacesService.select(request.auth!.userId, request.workspace!.workspaceId),
  });
});
