import type { CashFlowReportQuery, ReportGroup, ReportPeriodType } from "./reports.schemas.js";
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}
export interface ReportPeriod {
  type: ReportPeriodType;
  start: Date;
  endExclusive: Date;
  previousStart: Date;
  previousEndExclusive: Date;
  timezone: string;
  startLocal: LocalDate;
  endLocalExclusive: LocalDate;
}
const fmt = (tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
const parts = (d: Date, tz: string) =>
  Object.fromEntries(
    fmt(tz)
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
export const parseLocal = (s: string): LocalDate => {
  const [y, m, d] = s.split("-").map(Number);
  return { year: y!, month: m!, day: d! };
};
export const localIso = (v: LocalDate) =>
  `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`;
export const addLocalDays = (v: LocalDate, n: number): LocalDate => {
  const d = new Date(Date.UTC(v.year, v.month - 1, v.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const month = (v: LocalDate, n: number) => {
  const d = new Date(Date.UTC(v.year, v.month - 1 + n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 };
};
const year = (v: LocalDate, n: number) => ({ year: v.year + n, month: 1, day: 1 });
export const localMidnight = (v: LocalDate, tz: string) => {
  const target = Date.UTC(v.year, v.month - 1, v.day);
  let instant = target;
  for (let i = 0; i < 3; i += 1) {
    const p = parts(new Date(instant), tz);
    instant += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return new Date(instant);
};
const dayDiff = (a: LocalDate, b: LocalDate) =>
  Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
export const buildReportPeriod = (
  q: {
    period: ReportPeriodType;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  },
  tz: string,
  now = new Date(),
): ReportPeriod => {
  fmt(tz).format(now);
  const p = parts(now, tz),
    today = { year: p.year, month: p.month, day: p.day };
  let start: LocalDate, end: LocalDate, prev: LocalDate;
  if (q.period === "CURRENT_MONTH") {
    start = month(today, 0);
    end = month(today, 1);
    prev = month(today, -1);
  } else if (q.period === "PREVIOUS_MONTH") {
    start = month(today, -1);
    end = month(today, 0);
    prev = month(today, -2);
  } else if (q.period === "CURRENT_YEAR") {
    start = year(today, 0);
    end = year(today, 1);
    prev = year(today, -1);
  } else if (q.period === "PREVIOUS_YEAR") {
    start = year(today, -1);
    end = year(today, 0);
    prev = year(today, -2);
  } else if (q.period === "LAST_7_DAYS" || q.period === "LAST_30_DAYS") {
    const n = q.period === "LAST_7_DAYS" ? 7 : 30;
    end = addLocalDays(today, 1);
    start = addLocalDays(end, -n);
    prev = addLocalDays(start, -n);
  } else {
    start = parseLocal(q.dateFrom!);
    end = addLocalDays(parseLocal(q.dateTo!), 1);
    prev = addLocalDays(start, -dayDiff(start, end));
  }
  return {
    type: q.period,
    start: localMidnight(start, tz),
    endExclusive: localMidnight(end, tz),
    previousStart: localMidnight(prev, tz),
    previousEndExclusive: localMidnight(start, tz),
    timezone: tz,
    startLocal: start,
    endLocalExclusive: end,
  };
};
export const resolveGroup = (q: CashFlowReportQuery, p: ReportPeriod): ReportGroup =>
  q.groupBy ??
  (["CURRENT_YEAR", "PREVIOUS_YEAR"].includes(q.period)
    ? "MONTH"
    : q.period === "CUSTOM" && dayDiff(p.startLocal, p.endLocalExclusive) > 31
      ? dayDiff(p.startLocal, p.endLocalExclusive) <= 120
        ? "WEEK"
        : "MONTH"
      : "DAY");
export interface ReportBucket {
  startLocal: LocalDate;
  endLocalExclusive: LocalDate;
  start: Date;
  endExclusive: Date;
}
export const buildBuckets = (p: ReportPeriod, g: ReportGroup): ReportBucket[] => {
  const out: ReportBucket[] = [];
  let cursor = p.startLocal;
  while (localIso(cursor) < localIso(p.endLocalExclusive)) {
    let next: LocalDate;
    if (g === "DAY") next = addLocalDays(cursor, 1);
    else if (g === "WEEK") next = addLocalDays(cursor, 7);
    else next = month(cursor, 1);
    if (localIso(next) > localIso(p.endLocalExclusive)) next = p.endLocalExclusive;
    out.push({
      startLocal: cursor,
      endLocalExclusive: next,
      start: localMidnight(cursor, p.timezone),
      endExclusive: localMidnight(next, p.timezone),
    });
    cursor = next;
  }
  return out;
};
