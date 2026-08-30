import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./informal-balances.controller.js";

const router = Router({ mergeParams: true });
router.get("/summary", requirePermission("debts.read"), controller.summary);
router.get("/", requirePermission("debts.read"), controller.list);
router.post("/", requirePermission("debts.write"), controller.create);
router.get("/:informalBalanceId", requirePermission("debts.read"), controller.get);
router.patch("/:informalBalanceId", requirePermission("debts.write"), controller.update);
router.delete("/:informalBalanceId", requirePermission("debts.write"), controller.archive);
router.post(
  "/:informalBalanceId/payments",
  requirePermission("debts.write"),
  controller.pay,
);

export default router;
