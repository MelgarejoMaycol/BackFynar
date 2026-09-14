import { Prisma } from "@prisma/client";
import { AppError, ValidationError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import {
  frankfurterProvider,
  type ExchangeRateHistoryGroup,
  type ExchangeRateProvider,
  type ExchangeRateRow,
} from "./frankfurter.provider.js";

type CacheStatus = "LIVE" | "CACHE" | "STALE";

type CacheEntry<T> = {
  value: T;
  fetchedAt: string;
  freshUntil: number;
  staleUntil: number;
};

export type ExchangeRatesConfig = {
  providerName: string;
  defaultBase: string;
  currencies: string[];
  cacheTtlMs: number;
  staleTtlMs: number;
};

const normalizeCurrencies = (currencies: string[], defaultBase: string) =>
  [...new Set([defaultBase, ...currencies].map((code) => code.trim().toUpperCase()))].filter(
    (code) => /^[A-Z]{3}$/.test(code),
  );

const defaultConfig: ExchangeRatesConfig = {
  providerName: env.FX_PROVIDER,
  defaultBase: env.FX_DEFAULT_BASE_CURRENCY,
  currencies: normalizeCurrencies(
    env.FX_DEFAULT_CURRENCIES.split(","),
    env.FX_DEFAULT_BASE_CURRENCY,
  ),
  cacheTtlMs: env.FX_CACHE_TTL_SECONDS * 1000,
  staleTtlMs: env.FX_STALE_TTL_SECONDS * 1000,
};

const currencyMinorUnits = (currency: string) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits;

const currencyName = (currency: string) =>
  new Intl.DisplayNames(["es"], { type: "currency" }).of(currency) ?? currency;

const currencySymbol = (currency: string) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? currency;

const providerFailure = (error: unknown) =>
  new AppError(error instanceof Error ? error.message : "Proveedor de divisas no disponible", {
    status: 503,
    code: "FX_PROVIDER_UNAVAILABLE",
    publicMessage:
      "No pudimos actualizar las tasas de cambio. Intenta nuevamente en unos minutos.",
  });

export class ExchangeRatesService {
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly provider: ExchangeRateProvider = frankfurterProvider,
    private readonly config: ExchangeRatesConfig = defaultConfig,
  ) {}

  currencies() {
    return {
      defaultBase: this.config.defaultBase,
      currencies: this.config.currencies.map((code) => ({
        code,
        name: currencyName(code),
        symbol: currencySymbol(code),
        minorUnits: currencyMinorUnits(code),
      })),
    };
  }

  private assertSupported(...currencies: string[]) {
    for (const currency of currencies) {
      if (!this.config.currencies.includes(currency)) {
        throw new ValidationError(`La moneda ${currency} no está habilitada en Fynar`, {
          currency,
          supportedCurrencies: this.config.currencies,
        });
      }
    }
  }

  private async cached<T>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<{ value: T; fetchedAt: string; cacheStatus: CacheStatus }> {
    const now = Date.now();
    const existing = this.cache.get(key) as CacheEntry<T> | undefined;
    if (existing && now <= existing.freshUntil) {
      return {
        value: existing.value,
        fetchedAt: existing.fetchedAt,
        cacheStatus: "CACHE",
      };
    }

    try {
      const value = await loader();
      const fetchedAt = new Date().toISOString();
      this.cache.set(key, {
        value,
        fetchedAt,
        freshUntil: now + this.config.cacheTtlMs,
        staleUntil: now + this.config.staleTtlMs,
      });
      return { value, fetchedAt, cacheStatus: "LIVE" };
    } catch (error: unknown) {
      if (existing && now <= existing.staleUntil) {
        return {
          value: existing.value,
          fetchedAt: existing.fetchedAt,
          cacheStatus: "STALE",
        };
      }
      throw providerFailure(error);
    }
  }

  async rate(base: string, quote: string) {
    this.assertSupported(base, quote);
    if (base === quote) {
      return {
        date: new Date().toISOString().slice(0, 10),
        base,
        quote,
        rate: "1",
        provider: this.config.providerName,
        fetchedAt: new Date().toISOString(),
        cacheStatus: "LIVE" as const,
      };
    }

    const cached = await this.cached<ExchangeRateRow>(
      `rate:${base}:${quote}`,
      () => this.provider.getRate(base, quote),
    );
    return {
      ...cached.value,
      provider: this.config.providerName,
      fetchedAt: cached.fetchedAt,
      cacheStatus: cached.cacheStatus,
    };
  }

  async rates(base = this.config.defaultBase, quotes?: string[]) {
    const selected = (quotes?.length ? quotes : this.config.currencies).filter(
      (quote) => quote !== base,
    );
    this.assertSupported(base, ...selected);
    if (!selected.length) {
      return {
        base,
        rates: [],
        provider: this.config.providerName,
        fetchedAt: new Date().toISOString(),
        cacheStatus: "LIVE" as const,
      };
    }

    const normalizedQuotes = [...new Set(selected)].sort();
    const cached = await this.cached<ExchangeRateRow[]>(
      `rates:${base}:${normalizedQuotes.join(",")}`,
      () => this.provider.getRates(base, normalizedQuotes),
    );
    return {
      base,
      rates: cached.value,
      provider: this.config.providerName,
      fetchedAt: cached.fetchedAt,
      cacheStatus: cached.cacheStatus,
    };
  }

  async convert(from: string, to: string, amount: string) {
    const rate = await this.rate(from, to);
    const convertedAmount = new Prisma.Decimal(amount)
      .mul(rate.rate)
      .toDecimalPlaces(currencyMinorUnits(to))
      .toFixed(currencyMinorUnits(to));

    return {
      from,
      to,
      amount,
      rate: rate.rate,
      convertedAmount,
      date: rate.date,
      provider: rate.provider,
      fetchedAt: rate.fetchedAt,
      cacheStatus: rate.cacheStatus,
      disclaimer:
        "Tasa de referencia. El valor final de una entidad financiera puede incluir margen, comisión o impuestos.",
    };
  }

  async history(
    base: string,
    quote: string,
    from: string,
    to: string,
    group?: ExchangeRateHistoryGroup,
  ) {
    this.assertSupported(base, quote);
    const cached = await this.cached<ExchangeRateRow[]>(
      `history:${base}:${quote}:${from}:${to}:${group ?? "day"}`,
      () => this.provider.getHistory(base, quote, from, to, group),
    );
    return {
      base,
      quote,
      from,
      to,
      group: group ?? "day",
      points: cached.value.map((row) => ({
        date: row.date,
        rate: row.rate,
      })),
      provider: this.config.providerName,
      fetchedAt: cached.fetchedAt,
      cacheStatus: cached.cacheStatus,
    };
  }
}

export const exchangeRatesService = new ExchangeRatesService();
