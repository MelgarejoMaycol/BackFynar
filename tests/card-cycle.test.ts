import { describe, expect, it } from "vitest";
import { cardCycleDates, nextMonthlyDate, validDayOfMonth } from "../src/modules/cards/domain/card-cycle.js";

const iso = (date: Date | null) => date?.toISOString().slice(0, 10);
describe("ciclo mensual de tarjeta", () => {
  it("calcula corte y pago próximos en la zona del workspace", () => {
    const cycle = cardCycleDates(new Date("2026-08-14T23:30:00Z"), 20, 5, "America/Bogota");
    expect(iso(cycle.nextBillingDate)).toBe("2026-08-20");
    expect(iso(cycle.nextPaymentDate)).toBe("2026-09-05");
  });
  it("avanza al mes siguiente cuando el día ya pasó", () => {
    expect(iso(nextMonthlyDate(new Date("2026-08-21T12:00:00Z"), 20, "America/Bogota"))).toBe("2026-09-20");
  });
  it("ajusta día 31 y respeta febrero bisiesto", () => {
    expect(validDayOfMonth(2026, 2, 31)).toBe(28);
    expect(validDayOfMonth(2028, 2, 31)).toBe(29);
    expect(validDayOfMonth(2026, 4, 31)).toBe(30);
  });
  it("maneja diciembre a enero", () => {
    expect(iso(nextMonthlyDate(new Date("2026-12-31T18:00:00Z"), 5, "America/Bogota"))).toBe("2027-01-05");
  });
});
