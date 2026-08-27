import { z } from "zod";

const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "Debe enviar al menos un campo",
    });

const optionalText = (max: number) => z.union([z.string().trim().min(1).max(max), z.null()]);
export const updateProfileSchema = nonEmptyPatch({
  firstName: z.string().trim().min(1).max(80),
  lastName: optionalText(80),
  phone: z.union([
    z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,30}$/),
    z.null(),
  ]),
  avatarUrl: z.union([z.string().trim().url().max(2048), z.null()]),
});

const validTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};
const dashboardLayout = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 16_384, "dashboardLayout excede 16 KiB");

export const updatePreferencesSchema = nonEmptyPatch({
  defaultWorkspaceId: z.union([z.string().uuid(), z.null()]),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
    .max(10),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  timezone: z.string().trim().max(60).refine(validTimezone, "Zona horaria invalida"),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
  startScreen: z.enum(["DASHBOARD", "TRANSACTIONS", "BUDGETS", "DEBTS"]),
  dashboardLayout,
  financialCycleStartDay: z.union([z.number().int().min(1).max(28), z.null()]),
});

export const deleteAccountSchema = z.object({ confirmation: z.literal("ELIMINAR") }).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
