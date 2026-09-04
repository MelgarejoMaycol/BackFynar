import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./financial-health.controller.js";

const router = Router({ mergeParams: true });
router.get("/", requirePermission("reports.read"), controller.current);
router.get("/history", requirePermission("reports.read"), controller.history);
export default router;
