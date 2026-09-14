import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./investments.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("reports.read"), controller.list);
router.post("/", requirePermission("transactions.write"), controller.create);
router.get("/:planId", requirePermission("reports.read"), controller.get);
router.patch("/:planId", requirePermission("transactions.write"), controller.update);
router.get("/:planId/progress", requirePermission("reports.read"), controller.progress);
router.post("/:planId/start", requirePermission("transactions.write"), controller.start);
router.post("/:planId/pause", requirePermission("transactions.write"), controller.pause);
router.post("/:planId/resume", requirePermission("transactions.write"), controller.resume);
router.post("/:planId/complete", requirePermission("transactions.write"), controller.complete);
router.post("/:planId/archive", requirePermission("transactions.write"), controller.archive);
router.post("/:planId/contributions", requirePermission("transactions.write"), controller.contribute);
router.post("/:planId/withdrawals", requirePermission("transactions.write"), controller.withdraw);
router.post("/:planId/valuations", requirePermission("transactions.write"), controller.valuation);

export default router;
