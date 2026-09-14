import type { NextFunction, Request, Response } from "express";
import {
  investmentFinancialImpactSchema,
  investmentScenarioSchema,
  investmentSimulationSchema,
  purchaseSimulationSchema,
} from "./simulations.schemas.js";
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


export function investmentOptions(request: Request, response: Response, next: NextFunction): void {
  try {
    response.status(200).json({
      success: true,
      data: simulationsService.investmentOptions(request.workspace!.workspace.baseCurrency),
    });
  } catch (error) {
    next(error);
  }
}

export function calculateInvestment(request: Request, response: Response, next: NextFunction): void {
  try {
    const input = investmentSimulationSchema.parse(request.body);
    response.status(200).json({
      success: true,
      data: simulationsService.investment(input),
    });
  } catch (error) {
    next(error);
  }
}

export function investmentScenarios(request: Request, response: Response, next: NextFunction): void {
  try {
    const input = investmentScenarioSchema.parse(request.body);
    response.status(200).json({
      success: true,
      data: simulationsService.investmentScenarios(input),
    });
  } catch (error) {
    next(error);
  }
}

export function investmentFinancialImpact(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  try {
    const input = investmentFinancialImpactSchema.parse(request.body);
    void simulationsService
      .investmentFinancialImpact(
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
