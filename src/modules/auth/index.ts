export { registerSchema } from "./auth.schemas.js";
export type { RegisterInput } from "./auth.schemas.js";
export {
  createArgon2PasswordService,
  passwordService,
  PasswordServiceInputError,
} from "./auth-password.service.js";
export type { PasswordHashConfig, PasswordService } from "./auth-password.service.js";
export { default as authRouter } from "./auth.routes.js";
