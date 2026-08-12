import "dotenv/config";
import { randomUUID } from "node:crypto";
import { EmailProviderError, emailService } from "../src/modules/auth/email.service.js";

if (process.env.NODE_ENV === "production")
  throw new Error("email:test no está disponible en producción");
const recipient = process.argv[2];
if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient))
  throw new Error("Uso: npm run email:test -- correo@example.com");
try {
  const delivery = await emailService.sendVerification({
    recipient,
    firstName: "Prueba",
    verificationUrl: `${process.env.APP_WEB_URL ?? "http://localhost:5173"}/verify-email?token=test-${randomUUID()}`,
    expiresInHours: 1,
  });
  console.log(
    JSON.stringify({
      success: true,
      recipientDomain: recipient.split("@")[1],
      provider: delivery?.provider,
      messageId: delivery?.messageId,
    }),
  );
} catch (error: unknown) {
  console.error(
    JSON.stringify({
      success: false,
      code: "EMAIL_PROVIDER_ERROR",
      recipientDomain: recipient.split("@")[1],
      provider: error instanceof EmailProviderError ? error.provider : undefined,
      status: error instanceof EmailProviderError ? error.status : undefined,
      providerCode: error instanceof EmailProviderError ? error.providerCode : undefined,
      providerMessage: error instanceof EmailProviderError ? error.providerMessage : undefined,
    }),
  );
  process.exitCode = 1;
}
