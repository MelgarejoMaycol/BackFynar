import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateCardStatementBalance } from "../src/modules/cards/domain/card-statement.js";

describe("cálculo de extracto", () => {
  it("resta pagos realizados dentro del periodo", () => {
    const value = calculateCardStatementBalance({
      previousBalance: new Prisma.Decimal("100000"),
      purchases: new Prisma.Decimal("50000"),
      payments: new Prisma.Decimal("30000"),
      interest: new Prisma.Decimal("0"),
      fees: new Prisma.Decimal("0"),
    });
    expect(value.toFixed(2)).toBe("120000.00");
  });
});
