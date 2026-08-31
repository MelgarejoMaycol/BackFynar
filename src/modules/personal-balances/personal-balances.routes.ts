import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./personal-balances.controller.js";

const router = Router({ mergeParams: true });

router.get("/summary", requirePermission("debts.read"), controller.summary);
router.get("/people", requirePermission("debts.read"), controller.listPeople);
router.post("/people", requirePermission("debts.write"), controller.createPerson);
router.patch("/people/:personId", requirePermission("debts.write"), controller.updatePerson);
router.delete("/people/:personId", requirePermission("debts.write"), controller.archivePerson);
router.get("/", requirePermission("debts.read"), controller.list);
router.post("/", requirePermission("debts.write"), controller.create);
router.get("/:personalBalanceId", requirePermission("debts.read"), controller.get);
router.patch("/:personalBalanceId", requirePermission("debts.write"), controller.update);
router.post("/:personalBalanceId/entries", requirePermission("debts.write"), controller.addEntry);
router.post("/:personalBalanceId/settle", requirePermission("debts.write"), controller.settle);
router.post("/:personalBalanceId/entries/:entryId/reverse", requirePermission("debts.write"), controller.reverseEntry);
router.delete("/:personalBalanceId", requirePermission("debts.write"), controller.archive);

export default router;
