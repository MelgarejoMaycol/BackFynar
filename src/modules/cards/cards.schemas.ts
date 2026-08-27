import { z } from "zod";
const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/),
  rate = z.string().regex(/^\d{1,3}(?:\.\d{1,7})?$/);
const cents = (value: string) => {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};
export const uuid = z.string().uuid();
export const createCardSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    institutionName: z.string().trim().min(1).max(120).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    creditLimit: money.refine((value) => cents(value) > 0n, "El cupo debe ser mayor que cero"),
    availableCredit: money.optional(),
    usedCredit: money.optional(),
    billingDay: z.number().int().min(1).max(31).optional(),
    paymentDueDay: z.number().int().min(1).max(31).optional(),
    referencePeriodicRate: rate.optional(),
    referenceRateSource: z.enum(["INFORMED", "ESTIMATED"]).optional(),
  })
  .strict()
  .refine((x) => !(x.availableCredit && x.usedCredit), "Informa disponible o utilizado, no ambos")
  .superRefine((x, context) => {
    const knownBalance = x.availableCredit ?? x.usedCredit;
    if (knownBalance && cents(knownBalance) > cents(x.creditLimit)) {
      context.addIssue({
        code: "custom",
        path: [x.availableCredit ? "availableCredit" : "usedCredit"],
        message: "No puede superar el cupo total",
      });
    }
  });
export const updateCardSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    institutionName: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
    creditLimit: money.refine((value) => cents(value) > 0n).optional(),
    billingDay: z.union([z.number().int().min(1).max(31), z.null()]).optional(),
    paymentDueDay: z.union([z.number().int().min(1).max(31), z.null()]).optional(),
    referencePeriodicRate: z.union([rate, z.null()]).optional(),
    referenceRateSource: z.union([z.enum(["INFORMED", "ESTIMATED"]), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Debe enviar al menos un campo");
export const cashAdvanceSchema = z
  .object({
    destinationAccountId: uuid,
    amount: money.refine((value) => cents(value) > 0n, "El monto debe ser mayor que cero"),
    feeAmount: money.default("0"),
    occurredAt: z.string().datetime({ offset: true }),
    periodicRate: rate.optional(),
    installmentCount: z.number().int().min(1).max(120).optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export const purchaseSchema = z
  .object({
    amount: money.refine((value) => cents(value) > 0n, "El monto debe ser mayor que cero"),
    categoryId: uuid,
    occurredAt: z.string().datetime({ offset: true }),
    description: z.string().trim().min(1).max(250),
    installmentCount: z.number().int().min(1).max(120).default(1),
    periodicRate: rate.optional(),
    firstDueDate: z.string().date(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export const statementSchema = z
  .object({
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    dueDate: z.string().date(),
    previousBalance: money,
    interestAmount: money,
    feeAmount: money,
    minimumPayment: money,
    reportedBalance: money.optional(),
  })
  .strict();
export const cardPaymentExpectationSchema = z
  .object({
    amount: money.refine((value) => cents(value) > 0n, "El valor debe ser mayor que cero"),
    dueDate: z.string().date(),
    minimumPayment: money.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minimumPayment && cents(value.minimumPayment) > cents(value.amount)) {
      context.addIssue({
        code: "custom",
        path: ["minimumPayment"],
        message: "El pago mínimo no puede superar el próximo pago",
      });
    }
  });
export const cardPaymentSchema = z
  .object({
    sourceAccountId: uuid,
    amount: money.refine((value) => cents(value) > 0n, "El pago debe ser mayor que cero"),
    occurredAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().min(8).max(100),
    applyToNextPayment: z.boolean().optional(),
  })
  .strict();
