import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 80;

const optionalLastNameSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).max(NAME_MAX_LENGTH).optional(),
);

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).email(),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    firstName: z.string().trim().min(1).max(NAME_MAX_LENGTH),
    lastName: optionalLastNameSchema,
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).email(),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).email(),
  })
  .strict();
export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(512),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
    message: "La nueva contraseña debe ser diferente",
    path: ["newPassword"],
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
