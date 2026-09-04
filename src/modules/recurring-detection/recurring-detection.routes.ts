import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./recurring-detection.controller.js";

const router = Router({ mergeParams: true });

router.get("/suggestions", requirePermission("debts.read"), controller.suggestions);
router.post("/run", requirePermission("debts.write"), controller.run);
router.post(
  "/suggestions/:suggestionId/dismiss",
  requirePermission("debts.write"),
  controller.dismiss,
);
router.post(
  "/suggestions/:suggestionId/confirm",
  requirePermission("debts.write"),
  controller.confirm,
);

export default router;
