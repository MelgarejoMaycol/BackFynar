import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./goals.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("goals.read"), controller.list);
router.post("/", requirePermission("goals.write"), controller.create);
router.get("/:goalId/projection", requirePermission("goals.read"), controller.projection);
router.post("/:goalId/contributions", requirePermission("goals.write"), controller.contribute);
router.post(
  "/:goalId/contributions/:contributionId/reverse",
  requirePermission("goals.write"),
  controller.reverseContribution,
);
router.post("/:goalId/pause", requirePermission("goals.write"), controller.pause);
router.post("/:goalId/resume", requirePermission("goals.write"), controller.resume);
router.post("/:goalId/complete", requirePermission("goals.write"), controller.complete);
router.post("/:goalId/restore", requirePermission("goals.write"), controller.restore);
router.get("/:goalId", requirePermission("goals.read"), controller.get);
router.patch("/:goalId", requirePermission("goals.write"), controller.update);
router.delete("/:goalId", requirePermission("goals.write"), controller.archive);

export default router;
