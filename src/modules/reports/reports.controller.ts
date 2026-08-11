import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  accountBalancesReportSchema,
  cashFlowReportSchema,
  categoryReportSchema,
  commonReportSchema,
} from "./reports.schemas.js";
import { reportsService } from "./reports.service.js";

type ReportHandler = (request: Request, response: Response, next: NextFunction) => void;

function handler(
  schema:
    | typeof commonReportSchema
    | typeof categoryReportSchema
    | typeof cashFlowReportSchema
    | typeof accountBalancesReportSchema,
  execute: (request: Request, query: never) => Promise<unknown>,
): ReportHandler {
  return (request, response, next) => {
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      next(new ValidationError("Parámetros de reporte inválidos", parsed.error.issues));
      return;
    }
    void execute(request, parsed.data as never)
      .then((data) => response.status(200).json({ success: true, data }))
      .catch(next);
  };
}

const workspace = (request: Request) => request.workspace!.workspaceId;
const timezone = (request: Request) => request.workspace!.workspace.timezone;

export const incomeVsExpenses = handler(commonReportSchema, (request, query) =>
  reportsService.incomeVsExpenses(workspace(request), timezone(request), query),
);
export const expensesByCategory = handler(categoryReportSchema, (request, query) =>
  reportsService.expensesByCategory(workspace(request), timezone(request), query),
);
export const cashFlow = handler(cashFlowReportSchema, (request, query) =>
  reportsService.cashFlow(workspace(request), timezone(request), query),
);
export const accountBalances = handler(accountBalancesReportSchema, (request, query) =>
  reportsService.accountBalances(workspace(request), query),
);
