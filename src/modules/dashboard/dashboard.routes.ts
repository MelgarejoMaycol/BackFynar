import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import { getDashboard } from "./dashboard.controller.js";

const router = Router({ mergeParams: true });
router.get("/", requirePermission("reports.read"), getDashboard);
export default router;
