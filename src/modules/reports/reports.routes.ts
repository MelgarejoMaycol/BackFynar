import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./reports.controller.js";

const router = Router({ mergeParams: true });
router.use(requirePermission("reports.read"));
router.get("/income-vs-expenses", controller.incomeVsExpenses);
router.get("/expenses-by-category", controller.expensesByCategory);
router.get("/cash-flow", controller.cashFlow);
router.get("/account-balances", controller.accountBalances);
export default router;
