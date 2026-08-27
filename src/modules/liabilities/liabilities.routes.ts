import { Router } from "express";
import { requirePermission } from "../workspaces/workspace-context.js";
import { liabilitiesService as s } from "./liabilities.service.js";
const r = Router({ mergeParams: true });
r.get("/upcoming-payments", requirePermission("debts.read"), (q, p, n) => {
  const mode = String(q.query.mode ?? "next").toLowerCase();
  const from = typeof q.query.from === "string" ? q.query.from : null;
  const to = typeof q.query.to === "string" ? q.query.to : null;
  const run = mode === "calendar" && from && to
    ? () => s.calendarRange(q.workspace!.workspaceId, from, to)
    : () => s.upcoming(q.workspace!.workspaceId);
  void run()
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
