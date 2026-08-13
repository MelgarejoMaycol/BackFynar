import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import * as c from "./obligations.controller.js";
const r = Router({ mergeParams: true });
r.post("/", requirePermission("debts.write"), c.create);
r.get("/", requirePermission("debts.read"), c.list);
r.get("/:obligationId", requirePermission("debts.read"), c.get);
r.patch("/:obligationId", requirePermission("debts.write"), c.update);
r.delete("/:obligationId", requirePermission("debts.write"), c.archive);
r.post("/:obligationId/occurrences", requirePermission("debts.write"), c.occurrence);
r.post(
  "/:obligationId/occurrences/:occurrenceId/payments",
  requirePermission("debts.write"),
  c.pay,
);
export default r;
