import type { NextFunction, Request, Response } from "express";
import {
  convertQuerySchema,
  historyQuerySchema,
  ratesQuerySchema,
} from "./exchange-rates.schemas.js";
import { exchangeRatesService } from "./exchange-rates.service.js";

export async function getCurrencies(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    response.status(200).json({
      success: true,
      data: exchangeRatesService.currencies(),
    });
  } catch (error: unknown) {
    next(error);
  }
}

export async function getRates(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = ratesQuerySchema.parse(request.query);
    const data = await exchangeRatesService.rates(input.base, input.quotes);
    response.status(200).json({ success: true, data });
  } catch (error: unknown) {
    next(error);
  }
}

export async function convertCurrency(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = convertQuerySchema.parse(request.query);
    const data = await exchangeRatesService.convert(input.from, input.to, input.amount);
    response.status(200).json({ success: true, data });
  } catch (error: unknown) {
    next(error);
  }
}

export async function getHistory(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = historyQuerySchema.parse(request.query);
    const data = await exchangeRatesService.history(
      input.base,
      input.quote,
      input.from,
      input.to,
      input.group,
    );
    response.status(200).json({ success: true, data });
  } catch (error: unknown) {
    next(error);
  }
}
