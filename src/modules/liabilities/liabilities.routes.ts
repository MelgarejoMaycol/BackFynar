import { Router } from "express";
import { ValidationError } from "../../common/errors/app-error.js";
import { requirePermission } from "../workspaces/workspace-context.js";
import { liabilitiesService as s } from "./liabilities.service.js";

const r = Router({ mergeParams: true });
const DAY_MS = 86_400_000;
const MAX_CALENDAR_RANGE_DAYS = 370;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string, field: "from" | "to") {
  if (!DATE_ONLY.test(value)) {
    throw new ValidationError(`${field} debe usar el formato YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} no contiene una fecha válida`);
  }
  return date;
}

function validateCalendarRange(from: string, to: string) {
  const start = parseDateOnly(from, "from");
  const end = parseDateOnly(to, "to");
  if (start > end) {
    throw new ValidationError("El inicio del calendario no puede ser posterior al final");
  }
  const spanDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (spanDays > MAX_CALENDAR_RANGE_DAYS) {
    throw new ValidationError(
      `El calendario permite consultar como máximo ${MAX_CALENDAR_RANGE_DAYS} días`,
    );
  }
}

function dedupeCalendarItems<
  T extends { resourceId: string; date: string; source: string },
>(items: T[]) {
  const priority: Record<string, number> = {
    ACTUAL: 0,
    INFORMED: 1,
    ESTIMATED: 2,
    SCHEDULED: 3,
    PROJECTED: 4,
  };
  const selected = new Map<string, T>();
  for (const item of items) {
    const key = `${item.resourceId}:${item.date}`;
    const current = selected.get(key);
    if (!current || (priority[item.source] ?? 99) < (priority[current.source] ?? 99)) {
      selected.set(key, item);
    }
  }
  return [...selected.values()];
}

r.get("/upcoming-payments", requirePermission("debts.read"), (q, p, n) => {
  const mode = String(q.query.mode ?? "next").toLowerCase();
  const from = typeof q.query.from === "string" ? q.query.from : null;
  const to = typeof q.query.to === "string" ? q.query.to : null;

  try {
    if (mode === "calendar") {
      if (!from || !to) {
        throw new ValidationError("El calendario requiere los parámetros from y to");
      }
      validateCalendarRange(from, to);
      void s
        .calendarRange(q.workspace!.workspaceId, from, to)
        .then((data) =>
          p.json({
            success: true,
            data: dedupeCalendarItems(data).sort(
              (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
            ),
          }),
        )
        .catch(n);
      return;
    }

    void s
      .upcoming(q.workspace!.workspaceId)
      .then((data) => p.json({ success: true, data }))
      .catch(n);
  } catch (error) {
    n(error);
  }
});

r.get("/debts-summary", requirePermission("debts.read"), (q, p, n) => {
  void s
    .summary(q.workspace!.workspaceId)
    .then((data) => p.json({ success: true, data }))
    .catch(n);
});

export default r;
