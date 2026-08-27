import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildDashboardPeriod } from "../src/modules/dashboard/dashboard.period.js";
import { dashboardQuerySchema } from "../src/modules/dashboard/dashboard.schemas.js";
import { calculateChange, percentageOf } from "../src/modules/dashboard/dashboard.service.js";
import { toDashboardAccount } from "../src/modules/dashboard/dashboard.mapper.js";

describe("dashboard schemas y cálculos", () => {
  it("aplica periodo y límite predeterminados", () => {
    expect(dashboardQuerySchema.parse({})).toEqual({ period: "CURRENT_MONTH", recentLimit: 5 });
  });

  it("acepta un periodo personalizado válido", () => {
    expect(
      dashboardQuerySchema.safeParse({
        period: "CUSTOM",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
        recentLimit: "20",
      }).success,
    ).toBe(true);
  });

  it.each([
    { period: "CUSTOM", dateFrom: "2026-03-01" },
    { period: "CUSTOM", dateFrom: "2026-04-01", dateTo: "2026-03-01" },
    { period: "CURRENT_MONTH", dateFrom: "2026-03-01" },
    { recentLimit: 0 },
    { recentLimit: 21 },
  ])("rechaza consulta inválida %#", (query) => {
    expect(dashboardQuerySchema.safeParse(query).success).toBe(false);
  });

  it("construye el mes y mes anterior en la zona del workspace", () => {
    const query = dashboardQuerySchema.parse({ period: "CURRENT_MONTH" });
    const period = buildDashboardPeriod(query, "America/Bogota", new Date("2026-08-15T12:00:00Z"));
    expect(period.start.toISOString()).toBe("2026-08-01T05:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(period.previousStart.toISOString()).toBe("2026-07-01T05:00:00.000Z");
  });

  it("respeta cambios DST al construir límites locales", () => {
    const query = dashboardQuerySchema.parse({
      period: "CUSTOM",
      dateFrom: "2026-03-08",
      dateTo: "2026-03-08",
    });
    const period = buildDashboardPeriod(query, "America/New_York");
    expect(period.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("construye periodos móviles y su intervalo anterior", () => {
    const query = dashboardQuerySchema.parse({ period: "LAST_7_DAYS" });
    const period = buildDashboardPeriod(query, "UTC", new Date("2026-08-15T12:00:00Z"));
    expect(period.start.toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-08-16T00:00:00.000Z");
    expect(period.previousStart.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("calcula porcentajes y evita división por cero", () => {
    expect(percentageOf(new Prisma.Decimal("1"), new Prisma.Decimal("3"))).toBe("33.33");
    expect(percentageOf(new Prisma.Decimal("5"), new Prisma.Decimal("0"))).toBe("0.00");
    expect(calculateChange(new Prisma.Decimal("120"), new Prisma.Decimal("100"))).toEqual({
      amount: "20.00",
      percentage: "20.00",
    });
    expect(
      calculateChange(new Prisma.Decimal("20"), new Prisma.Decimal("0")).percentage,
    ).toBeNull();
  });

  it.each([
    ["2026-08-18T12:00:00Z", "2026-07-25T05:00:00.000Z", "2026-08-25T05:00:00.000Z"],
    ["2026-08-26T12:00:00Z", "2026-08-25T05:00:00.000Z", "2026-09-25T05:00:00.000Z"],
  ])("construye Mi ciclo 25 para %s", (now, expectedStart, expectedEnd) => {
    const query = dashboardQuerySchema.parse({ period: "MY_CYCLE" });
    const period = buildDashboardPeriod(query, "America/Bogota", new Date(now), 25);
    expect(period.start.toISOString()).toBe(expectedStart);
    expect(period.endExclusive.toISOString()).toBe(expectedEnd);
  });

  it("serializa Decimal sin convertir dinero a number", () => {
    const mapped = toDashboardAccount({
      id: "account",
      name: "Cuenta",
      type: "SAVINGS",
      nature: "ASSET",
      currency: "COP",
      currentBalance: new Prisma.Decimal("1234.5"),
      isFavorite: false,
      includeInNetWorth: true,
    });
    expect(mapped.currentBalance).toBe("1234.50");
  });
});
