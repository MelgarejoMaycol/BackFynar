import type { NextFunction, Request, Response } from "express";
import { purchaseSimulationSchema } from "./simulations.schemas.js";
import { simulationsService } from "./simulations.service.js";

export function simulatePurchase(request: Request, response: Response, next: NextFunction): void {
  try {
    const input = purchaseSimulationSchema.parse(request.body);
    void simulationsService
      .purchase(
        request.workspace!.workspaceId,
        request.workspace!.workspace.baseCurrency,
        request.workspace!.workspace.timezone,
        request.auth!.userId,
        input,
        new Date(),
      )
      .then((data) => response.status(200).json({ success: true, data }))
      .catch(next);
  } catch (error) {
    next(error);
  }
}
