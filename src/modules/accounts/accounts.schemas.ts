import { account_nature, account_type } from "@prisma/client";
import { z } from "zod";

export const moneySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, "Monto decimal invalido");
const positiveMoney = moneySchema.refine(
  (value) => !value.startsWith("-") && Number(value) > 0,
  "Debe ser positivo",
);
const cardFields = {
  creditLimit: z.union([positiveMoney, z.null()]).optional(),
  billingDay: z.union([z.number().int().min(1).max(31), z.null()]).optional(),
  paymentDueDay: z.union([z.number().int().min(1).max(31), z.null()]).optional(),
};
const controlledFields = {
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(account_type),
  nature: z.nativeEnum(account_nature),
  institutionName: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  openingBalance: moneySchema,
  ...cardFields,
  color: z.union([z.string().trim().min(1).max(20), z.null()]).optional(),
  icon: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
  includeInNetWorth: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
};

export const createAccountSchema = z
  .object(controlledFields)
  .strict()
  .refine(
    (value) => value.type !== account_type.CREDIT_CARD,
    "Las tarjetas de crédito se crean desde Créditos y pagos",
  );
export const updateAccountSchema = z
  .object(controlledFields)
  .omit({ openingBalance: true })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Debe enviar al menos un campo")
  .refine(
    (value) => value.type !== account_type.CREDIT_CARD,
    "Las tarjetas de crédito se administran desde Créditos y pagos",
  );
export const favoriteAccountSchema = z.object({ isFavorite: z.boolean() }).strict();
export const accountIdSchema = z.string().uuid();
export const listAccountsSchema = z
  .object({
    type: z.nativeEnum(account_type).optional(),
    nature: z.nativeEnum(account_nature).optional(),
    archived: z.enum(["true", "false"]).optional(),
    favorite: z.enum(["true", "false"]).optional(),
    excludeCreditCards: z.enum(["true", "false"]).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type ListAccountsInput = z.infer<typeof listAccountsSchema>;
