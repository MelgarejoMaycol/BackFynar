import { z } from "zod";
import { env } from "../../config/env.js";

export type ExchangeRateRow = {
  date: string;
  base: string;
  quote: string;
  rate: string;
};

export type ExchangeRateHistoryGroup = "week" | "month";

export interface ExchangeRateProvider {
  getRate(base: string, quote: string): Promise<ExchangeRateRow>;
  getRates(base: string, quotes: string[]): Promise<ExchangeRateRow[]>;
  getHistory(
    base: string,
    quote: string,
    from: string,
    to: string,
    group?: ExchangeRateHistoryGroup,
  ): Promise<ExchangeRateRow[]>;
}

const rateSchema = z.object({
  date: z.string(),
  base: z.string(),
  quote: z.string(),
  rate: z.number().positive(),
});

const ratesSchema = z.array(rateSchema);

export class FrankfurterProvider implements ExchangeRateProvider {
  constructor(
    private readonly baseUrl = env.FX_API_BASE_URL,
    private readonly timeoutMs = env.FX_REQUEST_TIMEOUT_MS,
  ) {}

  private async request(path: string, search?: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = new URL(
      `${this.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
    );
    if (search) url.search = search.toString();

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Frankfurter respondió ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getRate(base: string, quote: string): Promise<ExchangeRateRow> {
    const payload = rateSchema.parse(
      await this.request(`rate/${base.toLowerCase()}/${quote.toLowerCase()}`),
    );
    return {
      date: payload.date,
      base: payload.base.toUpperCase(),
      quote: payload.quote.toUpperCase(),
      rate: String(payload.rate),
    };
  }

  async getRates(base: string, quotes: string[]): Promise<ExchangeRateRow[]> {
    const search = new URLSearchParams({
      base: base.toLowerCase(),
      quotes: quotes.map((quote) => quote.toLowerCase()).join(","),
    });
    return ratesSchema.parse(await this.request("rates", search)).map((row) => ({
      date: row.date,
      base: row.base.toUpperCase(),
      quote: row.quote.toUpperCase(),
      rate: String(row.rate),
    }));
  }

  async getHistory(
    base: string,
    quote: string,
    from: string,
    to: string,
    group?: ExchangeRateHistoryGroup,
  ): Promise<ExchangeRateRow[]> {
    const search = new URLSearchParams({
      base: base.toLowerCase(),
      quotes: quote.toLowerCase(),
      from,
      to,
    });
    if (group) search.set("group", group);
    return ratesSchema.parse(await this.request("rates", search)).map((row) => ({
      date: row.date,
      base: row.base.toUpperCase(),
      quote: row.quote.toUpperCase(),
      rate: String(row.rate),
    }));
  }
}

export const frankfurterProvider = new FrankfurterProvider();
