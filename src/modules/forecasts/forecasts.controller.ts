import type { NextFunction, Request, Response } from "express";
import { forecastsService } from "./forecasts.service.js";

export function getMonthEndForecast(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  void forecastsService
    .monthEnd(
      request.workspace!.workspaceId,
      request.workspace!.workspace.baseCurrency,
      request.workspace!.workspace.timezone,
      request.auth!.userId,
      new Date(),
    )
    .then((data) => response.status(200).json({ success: true, data }))
    .catch(next);
}
