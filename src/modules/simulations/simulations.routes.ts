import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import {
  calculateInvestment,
  investmentFinancialImpact,
  investmentOptions,
  investmentScenarios,
  simulatePurchase,
} from "./simulations.controller.js";

const router = Router({ mergeParams: true });
router.post("/purchase", requirePermission("reports.read"), simulatePurchase);
router.get("/investment/options", requirePermission("reports.read"), investmentOptions);
router.post("/investment/calculate", requirePermission("reports.read"), calculateInvestment);
router.post("/investment/scenarios", requirePermission("reports.read"), investmentScenarios);
router.post(
  "/investment/financial-impact",
  requirePermission("reports.read"),
  investmentFinancialImpact,
);

export default router;
