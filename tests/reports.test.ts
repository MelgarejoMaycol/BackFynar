import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { reportChange, reportPercentage } from "../src/modules/reports/reports.mapper.js";
import {
  buildBuckets,
  buildReportPeriod,
  resolveGroup,
} from "../src/modules/reports/reports.period.js";
import {
  accountBalancesReportSchema,
  cashFlowReportSchema,
  categoryReportSchema,
  commonReportSchema,
} from "../src/modules/reports/reports.schemas.js";

describe("reportes básicos", () => {
  it("aplica filtros y paginación predeterminados", () => {
    expect(commonReportSchema.parse({})).toEqual({ period: "CURRENT_MONTH" });
    expect(categoryReportSchema.parse({}).limit).toBe(20);
    expect(accountBalancesReportSchema.parse({})).toMatchObject({
      includeArchived: "false",
      page: 1,
      limit: 25,
    });
  });

  it("normaliza moneda y coerciona paginación", () => {
    expect(accountBalancesReportSchema.parse({ currency: "cop", page: "2", limit: "100" })).toEqual(
      expect.objectContaining({ currency: "COP", page: 2, limit: 100 }),
    );
  });

  it.each([
    { period: "CUSTOM", dateFrom: "2026-01-01" },
    { period: "CUSTOM", dateFrom: "2026-03-01", dateTo: "2026-02-01" },
    { period: "CUSTOM", dateFrom: "2025-01-01", dateTo: "2026-01-02" },
    { period: "CURRENT_MONTH", dateFrom: "2026-01-01" },
    { currency: "USDT" },
    { accountId: "no-uuid" },
    { unexpected: true },
  ])("rechaza filtros inválidos %#", (query) => {
    expect(commonReportSchema.safeParse(query).success).toBe(false);
  });

  it.each([
    { period: "LAST_7_DAYS", groupBy: "WEEK" },
    { period: "CURRENT_YEAR", groupBy: "DAY" },
    {
      period: "CUSTOM",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-15",
      groupBy: "DAY",
    },
    {
      period: "CUSTOM",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-01",
      groupBy: "WEEK",
    },
  ])("rechaza granularidad incompatible %#", (query) => {
    expect(cashFlowReportSchema.safeParse(query).success).toBe(false);
  });

  it("construye año actual y comparación anterior en zona local", () => {
    const period = buildReportPeriod(
      { period: "CURRENT_YEAR" },
      "America/Bogota",
      new Date("2026-08-06T12:00:00Z"),
    );
    expect(period.start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2027-01-01T05:00:00.000Z");
    expect(period.previousStart.toISOString()).toBe("2025-01-01T05:00:00.000Z");
  });

  it("respeta DST y genera buckets diarios sin huecos", () => {
    const query = cashFlowReportSchema.parse({
      period: "CUSTOM",
      dateFrom: "2026-03-07",
      dateTo: "2026-03-09",
      groupBy: "DAY",
    });
    const period = buildReportPeriod(query, "America/New_York");
    const buckets = buildBuckets(period, resolveGroup(query, period));
    expect(buckets).toHaveLength(3);
    expect(buckets[1]!.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(buckets[1]!.endExclusive.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("elige granularidad automática por longitud", () => {
    const short = cashFlowReportSchema.parse({ period: "LAST_7_DAYS" });
    expect(resolveGroup(short, buildReportPeriod(short, "UTC"))).toBe("DAY");
    const yearly = cashFlowReportSchema.parse({ period: "CURRENT_YEAR" });
    expect(resolveGroup(yearly, buildReportPeriod(yearly, "UTC"))).toBe("MONTH");
  });

  it("mantiene dinero como Decimal y evita división por cero", () => {
    const value = new Prisma.Decimal("1");
    expect(reportPercentage(value, new Prisma.Decimal("3"))).toBe("33.33");
    expect(reportPercentage(value, new Prisma.Decimal("0"))).toBe("0.00");
    expect(reportChange(new Prisma.Decimal("20"), new Prisma.Decimal("0"))).toEqual({
      amount: "20.00",
      percentage: null,
    });
  });
});
