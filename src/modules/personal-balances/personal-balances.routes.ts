import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./personal-balances.controller.js";

const router = Router({ mergeParams: true });

router.get("/summary", requirePermission("debts.read"), controller.summary);
router.get("/", requirePermission("debts.read"), controller.list);
router.post("/", requirePermission("debts.write"), controller.create);
router.get("/:personalBalanceId", requirePermission("debts.read"), controller.get);
router.patch("/:personalBalanceId", requirePermission("debts.write"), controller.update);
router.post("/:personalBalanceId/entries", requirePermission("debts.write"), controller.addEntry);
router.post("/:personalBalanceId/settle", requirePermission("debts.write"), controller.settle);
router.delete("/:personalBalanceId", requirePermission("debts.write"), controller.archive);

export default router;
