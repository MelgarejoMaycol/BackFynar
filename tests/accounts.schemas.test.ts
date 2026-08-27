import { describe, expect, it } from "vitest";
import {
  createAccountSchema,
  favoriteAccountSchema,
  moneySchema,
  updateAccountSchema,
} from "../src/modules/accounts/accounts.schemas.js";
import { validateAccountCoherence } from "../src/modules/accounts/accounts.service.js";

const asset = {
  name: "Ahorros",
  type: "SAVINGS",
  nature: "ASSET",
  currency: "COP",
  openingBalance: "1500000.25",
} as const;
describe("schemas monetarios de cuentas", () => {
  it.each(["0", "0.00", "-10.25", "9999999999999999.99"])("acepta %s", (value) =>
    expect(moneySchema.safeParse(value).success).toBe(true),
  );
  it.each(["1.234", "1e3", "NaN", "Infinity", "01.00", "", 12.5])("rechaza %j", (value) =>
    expect(moneySchema.safeParse(value).success).toBe(false),
  );
  it("acepta cuentas bancarias y reserva las tarjetas para su modulo", () => {
    expect(createAccountSchema.safeParse(asset).success).toBe(true);
    expect(
      createAccountSchema.safeParse({
        name: "Tarjeta",
        type: "CREDIT_CARD",
        nature: "LIABILITY",
        currency: "COP",
        openingBalance: "-100.00",
        creditLimit: "5000.00",
        billingDay: 15,
        paymentDueDay: 28,
      }).success,
    ).toBe(false);
  });
  it("rechaza campos internos, enums, dias y limites invalidos", () => {
    for (const extra of [{ workspaceId: "x" }, { currentBalance: "1.00" }, { id: "x" }])
      expect(createAccountSchema.safeParse({ ...asset, ...extra }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...asset, type: "BANK" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...asset, nature: "MONEY" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...asset, billingDay: 32 }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...asset, creditLimit: "0.00" }).success).toBe(false);
  });
  it("valida coherencia tipo/naturaleza y campos de tarjeta", () => {
    expect(() => validateAccountCoherence({ type: "CASH", nature: "LIABILITY" })).toThrow();
    expect(() => validateAccountCoherence({ type: "CREDIT_CARD", nature: "ASSET" })).toThrow();
    expect(() =>
      validateAccountCoherence({ type: "CASH", nature: "ASSET", creditLimit: "10.00" }),
    ).toThrow();
    expect(() => validateAccountCoherence({ type: "OTHER", nature: "LIABILITY" })).not.toThrow();
  });
  it("exige patch no vacio y favorito estricto", () => {
    expect(updateAccountSchema.safeParse({}).success).toBe(false);
    expect(updateAccountSchema.safeParse({ name: "  Nueva  " }).success).toBe(true);
    expect(updateAccountSchema.safeParse({ openingBalance: "20.00" }).success).toBe(false);
    expect(updateAccountSchema.safeParse({ deletedAt: null }).success).toBe(false);
    expect(favoriteAccountSchema.safeParse({ isFavorite: true }).success).toBe(true);
    expect(favoriteAccountSchema.safeParse({ isFavorite: true, workspaceId: "x" }).success).toBe(
      false,
    );
  });
});
