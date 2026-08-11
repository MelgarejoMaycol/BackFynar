interface CalendarDate {
  year: number;
  month: number;
  day: number;
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
const parts = (date: Date, timezone: string) =>
  Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
const parseDate = (value: string): CalendarDate => {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
};
const addDays = (value: CalendarDate, days: number): CalendarDate => {
  const d = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const midnight = (value: CalendarDate, timezone: string): Date => {
  const desired = Date.UTC(value.year, value.month - 1, value.day);
  let instant = desired;
  for (let i = 0; i < 3; i += 1) {
    const actual = parts(new Date(instant), timezone);
    instant +=
      desired -
      Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
      );
  }
  return new Date(instant);
};
export const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);
export const budgetUtcRange = (startsOn: string, endsOn: string, timezone: string) => ({
  start: midnight(parseDate(startsOn), timezone),
  endExclusive: midnight(addDays(parseDate(endsOn), 1), timezone),
});
export const projectionDays = (
  startsOn: string,
  endsOn: string,
  timezone: string,
  now = new Date(),
) => {
  formatter(timezone).format(now);
  const todayParts = parts(now, timezone);
  const today = { year: todayParts.year, month: todayParts.month, day: todayParts.day };
  const start = parseDate(startsOn),
    end = parseDate(endsOn);
  const epoch = (d: CalendarDate) => Date.UTC(d.year, d.month - 1, d.day);
  const total = Math.round((epoch(end) - epoch(start)) / 86_400_000) + 1;
  if (epoch(today) < epoch(start)) return { elapsed: 0, total, phase: "BEFORE" as const };
  if (epoch(today) > epoch(end)) return { elapsed: total, total, phase: "AFTER" as const };
  return {
    elapsed: Math.round((epoch(today) - epoch(start)) / 86_400_000) + 1,
    total,
    phase: "DURING" as const,
  };
};
