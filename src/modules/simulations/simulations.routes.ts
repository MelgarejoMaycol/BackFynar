import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import { simulatePurchase } from "./simulations.controller.js";

const router = Router({ mergeParams: true });
router.post("/purchase", requirePermission("reports.read"), simulatePurchase);

export default router;
