import { z } from "zod";

export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Código de moneda inválido")
  .transform((value) => value.toUpperCase());

const quoteListSchema = z
  .string()
  .trim()
  .min(3)
  .transform((value) => value.split(",").map((quote) => quote.trim()))
  .pipe(z.array(currencyCodeSchema).min(1).max(20));

const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,18}(?:\.\d{1,8})?$/, "Monto inválido");

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export const ratesQuerySchema = z
  .object({
    base: currencyCodeSchema.optional(),
    quotes: quoteListSchema.optional(),
  })
  .strict();

export const convertQuerySchema = z
  .object({
    from: currencyCodeSchema,
    to: currencyCodeSchema,
    amount: decimalAmountSchema,
  })
  .strict();

export const historyQuerySchema = z
  .object({
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    from: isoDateSchema,
    to: isoDateSchema,
    group: z.enum(["week", "month"]).optional(),
  })
  .strict()
  .refine((value) => value.from <= value.to, {
    message: "La fecha inicial no puede ser posterior a la fecha final",
    path: ["from"],
  });
