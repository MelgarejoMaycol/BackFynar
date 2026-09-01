import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as controller from "./lending.controller.js";

const router = Router({ mergeParams: true });
router.get("/summary", requirePermission("debts.read"), controller.summary);
router.post("/simulate", requirePermission("debts.read"), controller.simulate);
router.get("/loans", requirePermission("debts.read"), controller.list);
router.post("/loans", requirePermission("debts.write"), controller.create);
router.get("/loans/:loanId", requirePermission("debts.read"), controller.get);
router.patch("/loans/:loanId", requirePermission("debts.write"), controller.update);
router.delete("/loans/:loanId", requirePermission("debts.write"), controller.archive);
router.post("/loans/:loanId/installments/:installmentId/payments", requirePermission("debts.write"), controller.pay);
router.post("/loans/:loanId/payments/:paymentId/reverse", requirePermission("debts.write"), controller.reverse);
export default router;
