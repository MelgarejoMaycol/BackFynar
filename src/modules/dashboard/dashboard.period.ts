import type { DashboardPeriodType, DashboardQuery } from "./dashboard.schemas.js";

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}
export interface DashboardPeriod {
  type: DashboardPeriodType;
  start: Date;
  endExclusive: Date;
  previousStart: Date;
  previousEndExclusive: Date;
  timezone: string;
}

const formatter = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

const partsAt = (date: Date, timezone: string) => {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
};

const localMidnightToUtc = (value: CalendarDate, timezone: string): Date => {
  const desired = Date.UTC(value.year, value.month - 1, value.day);
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsAt(new Date(instant), timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant += desired - represented;
  }
  return new Date(instant);
};

const dateFromIso = (value: string): CalendarDate => {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
};
const addDays = (value: CalendarDate, days: number): CalendarDate => {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};
const monthStart = (value: CalendarDate, offset: number): CalendarDate => {
  const date = new Date(Date.UTC(value.year, value.month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 };
};
const daysBetween = (from: CalendarDate, toExclusive: CalendarDate): number =>
  Math.round(
    (Date.UTC(toExclusive.year, toExclusive.month - 1, toExclusive.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  );

export function buildDashboardPeriod(
  query: DashboardQuery,
  timezone: string,
  now = new Date(),
): DashboardPeriod {
  formatter(timezone).format(now);
  const localNow = partsAt(now, timezone);
  const today = { year: localNow.year, month: localNow.month, day: localNow.day };
  let startLocal: CalendarDate;
  let endLocal: CalendarDate;
  let previousStartLocal: CalendarDate;
  if (query.period === "CURRENT_MONTH") {
    startLocal = monthStart(today, 0);
    endLocal = monthStart(today, 1);
    previousStartLocal = monthStart(today, -1);
  } else if (query.period === "PREVIOUS_MONTH") {
    startLocal = monthStart(today, -1);
    endLocal = monthStart(today, 0);
    previousStartLocal = monthStart(today, -2);
  } else if (query.period === "LAST_7_DAYS" || query.period === "LAST_30_DAYS") {
    const days = query.period === "LAST_7_DAYS" ? 7 : 30;
    endLocal = addDays(today, 1);
    startLocal = addDays(endLocal, -days);
    previousStartLocal = addDays(startLocal, -days);
  } else {
    startLocal = dateFromIso(query.dateFrom!);
    endLocal = addDays(dateFromIso(query.dateTo!), 1);
    previousStartLocal = addDays(startLocal, -daysBetween(startLocal, endLocal));
  }
  return {
    type: query.period,
    start: localMidnightToUtc(startLocal, timezone),
    endExclusive: localMidnightToUtc(endLocal, timezone),
    previousStart: localMidnightToUtc(previousStartLocal, timezone),
    previousEndExclusive: localMidnightToUtc(startLocal, timezone),
    timezone,
  };
}
