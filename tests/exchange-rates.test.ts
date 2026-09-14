import { describe, expect, it, vi } from "vitest";
import type {
  ExchangeRateHistoryGroup,
  ExchangeRateProvider,
  ExchangeRateRow,
} from "../src/modules/exchange-rates/frankfurter.provider.js";
import {
  ExchangeRatesService,
  type ExchangeRatesConfig,
} from "../src/modules/exchange-rates/exchange-rates.service.js";
import {
  convertQuerySchema,
  historyQuerySchema,
} from "../src/modules/exchange-rates/exchange-rates.schemas.js";

const config: ExchangeRatesConfig = {
  providerName: "test-provider",
  defaultBase: "COP",
  currencies: ["COP", "USD", "EUR", "JPY"],
  cacheTtlMs: 60_000,
  staleTtlMs: 86_400_000,
};

const row = (
  base: string,
  quote: string,
  rate: string,
  date = "2026-09-14",
): ExchangeRateRow => ({ base, quote, rate, date });

const provider = (rate = "0.00025"): ExchangeRateProvider => ({
  getRate: vi.fn(async (base: string, quote: string) => row(base, quote, rate)),
  getRates: vi.fn(async (base: string, quotes: string[]) =>
    quotes.map((quote: string) =>
      row(base, quote, quote === "USD" ? rate : "0.00022"),
    ),
  ),
  getHistory: vi.fn(
    async (
      base: string,
      quote: string,
      _from: string,
      _to: string,
      _group?: ExchangeRateHistoryGroup,
    ) => [row(base, quote, rate, "2026-09-01"), row(base, quote, "0.00026", "2026-09-14")],
  ),
});

describe("exchange rates service", () => {
  it("convierte con Decimal y reutiliza la tasa cacheada", async () => {
    const fxProvider = provider();
    const service = new ExchangeRatesService(fxProvider, config);

    const first = await service.convert("COP", "USD", "1000000");
    const second = await service.convert("COP", "USD", "2000000");

    expect(first.convertedAmount).toBe("250.00");
    expect(first.rate).toBe("0.00025");
    expect(second.convertedAmount).toBe("500.00");
    expect(fxProvider.getRate).toHaveBeenCalledTimes(1);
    expect(second.cacheStatus).toBe("CACHE");
  });

  it("resuelve identidad sin consultar al proveedor", async () => {
    const fxProvider = provider();
    const service = new ExchangeRatesService(fxProvider, config);

    const result = await service.convert("COP", "COP", "125000.50");

    expect(result.convertedAmount).toBe("125000.50");
    expect(result.rate).toBe("1");
    expect(fxProvider.getRate).not.toHaveBeenCalled();
  });

  it("rechaza monedas fuera de la lista configurada", async () => {
    const service = new ExchangeRatesService(provider(), config);

    await expect(service.convert("COP", "AUD", "1000")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("expone histórico normalizado para futuras gráficas", async () => {
    const service = new ExchangeRatesService(provider(), config);

    const result = await service.history(
      "COP",
      "USD",
      "2026-09-01",
      "2026-09-14",
      "week",
    );

    expect(result.points).toEqual([
      { date: "2026-09-01", rate: "0.00025" },
      { date: "2026-09-14", rate: "0.00026" },
    ]);
  });
});

describe("exchange rates query contracts", () => {
  it("normaliza monedas y valida montos", () => {
    expect(
      convertQuerySchema.parse({
        from: "cop",
        to: "usd",
        amount: "1000000.25",
      }),
    ).toEqual({ from: "COP", to: "USD", amount: "1000000.25" });
    expect(
      convertQuerySchema.safeParse({
        from: "COP",
        to: "USD",
        amount: "-100",
      }).success,
    ).toBe(false);
  });

  it("ignora parámetros auxiliares añadidos por proxies", () => {
    expect(
      convertQuerySchema.parse({
        from: "COP",
        to: "USD",
        amount: "1000000",
        path: "exchange-rates/convert",
      }),
    ).toEqual({ from: "COP", to: "USD", amount: "1000000" });
  });

  it("rechaza rangos históricos invertidos", () => {
    expect(
      historyQuerySchema.safeParse({
        base: "USD",
        quote: "COP",
        from: "2026-09-14",
        to: "2026-09-01",
      }).success,
    ).toBe(false);
  });
});
