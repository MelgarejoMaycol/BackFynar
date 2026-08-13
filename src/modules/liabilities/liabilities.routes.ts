import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import { liabilitiesService as s } from "./liabilities.service.js";
const r = Router({ mergeParams: true });
r.get("/upcoming-payments", requirePermission("debts.read"), (q, p, n) => {
  void s
    .upcoming(q.workspace!.workspaceId)
    .then((data) => p.json({ success: true, data }))
    .catch(n);
});
r.get("/debts-summary", requirePermission("debts.read"), (q, p, n) => {
  void s
    .summary(q.workspace!.workspaceId)
    .then((data) => p.json({ success: true, data }))
    .catch(n);
});
export default r;
