import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import { getMonthEndForecast } from "./forecasts.controller.js";

const router = Router({ mergeParams: true });
router.get("/month-end", requirePermission("reports.read"), getMonthEndForecast);
export default router;
