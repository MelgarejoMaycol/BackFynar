import { Resend } from "resend";
import { env } from "../../config/env.js";
import { logger } from "../../common/logging/logger.js";

export interface PasswordResetEmail {
  recipient: string;
  resetUrl: string;
}

export interface EmailService {
  sendPasswordReset(input: PasswordResetEmail): Promise<void>;
}

export class ResendEmailService implements EmailService {
  private readonly client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }
  async sendPasswordReset({ recipient, resetUrl }: PasswordResetEmail): Promise<void> {
    const result = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to: recipient,
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      subject: "Restablece tu contrasena de Fynar",
      text: `Abre este enlace para restablecer tu contrasena: ${resetUrl}`,
      html: `<p>Solicitaste restablecer tu contrasena de Fynar.</p><p><a href="${resetUrl}">Restablecer contrasena</a></p>`,
    });
    if (result.error) throw new Error(`RESEND_SEND_FAILED:${result.error.name}`);
  }
}

export class DevelopmentEmailService implements EmailService {
  async sendPasswordReset({ recipient }: PasswordResetEmail): Promise<void> {
    logger.info("Correo de recuperacion no enviado: proveedor de desarrollo", {
      recipientDomain: recipient.split("@")[1],
    });
  }
}

export const emailService: EmailService =
  env.EMAIL_PROVIDER === "resend"
    ? new ResendEmailService(env.RESEND_API_KEY as string)
    : new DevelopmentEmailService();
