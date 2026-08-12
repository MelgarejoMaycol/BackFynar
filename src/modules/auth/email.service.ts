import { Resend } from "resend";
import { env } from "../../config/env.js";
import { logger } from "../../common/logging/logger.js";

export interface PasswordResetEmail {
  recipient: string;
  resetUrl: string;
}
export interface VerificationEmail {
  recipient: string;
  firstName: string;
  verificationUrl: string;
  expiresInHours: number;
}
export interface EmailService {
  sendPasswordReset(input: PasswordResetEmail): Promise<EmailDelivery | void>;
  sendVerification(input: VerificationEmail): Promise<EmailDelivery | void>;
}
export interface EmailDelivery {
  provider: string;
  messageId?: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!,
  );
const shell = (title: string, body: string) =>
  `<!doctype html><html><body style="margin:0;background:#f6f8f7;font-family:Arial,sans-serif;color:#172b28"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #d6e1dc;border-radius:12px"><tr><td style="padding:28px"><div style="font-size:24px;font-weight:700;color:#154b45">Fynar</div><h1 style="font-size:26px;margin:24px 0 12px;color:#0d2b28">${title}</h1>${body}<p style="margin:28px 0 0;color:#5d6f6c;font-size:13px">Equipo Fynar</p></td></tr></table></td></tr></table></body></html>`;
const button = (label: string, url: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#154b45;color:#fff;text-decoration:none;font-weight:700">${label}</a></p>`;
const verificationHtml = ({ firstName, verificationUrl, expiresInHours }: VerificationEmail) =>
  shell(
    "Verifica tu correo",
    `<p>Hola ${escapeHtml(firstName)}, gracias por crear tu cuenta.</p><p>Confirma que este correo te pertenece para empezar a utilizar Fynar.</p>${button("Verificar mi correo", verificationUrl)}<p style="font-size:14px">Si el botón no funciona, copia esta dirección:</p><p style="word-break:break-all;font-size:13px"><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p><p>El enlace vence en ${expiresInHours} horas y solo puede utilizarse una vez.</p><p style="color:#5d6f6c">Si no creaste esta cuenta, puedes ignorar este mensaje.</p>`,
  );
const resetHtml = ({ resetUrl }: PasswordResetEmail) =>
  shell(
    "Restablece tu contraseña",
    `<p>Recibimos una solicitud para cambiar tu contraseña.</p>${button("Restablecer contraseña", resetUrl)}<p style="word-break:break-all;font-size:13px"><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>Si no realizaste esta solicitud, ignora este correo.</p>`,
  );

const sender = () => {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(env.EMAIL_FROM);
  return match
    ? { name: match[1]!.trim(), email: match[2]! }
    : { name: "Fynar", email: env.EMAIL_FROM };
};

export class EmailProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly providerCode?: string,
    public readonly providerMessage?: string,
  ) {
    super("EMAIL_PROVIDER_ERROR");
    this.name = "EmailProviderError";
  }
}

export class BrevoEmailService implements EmailService {
  constructor(private readonly apiKey: string) {}
  private async send(recipient: string, subject: string, htmlContent: string) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: sender(),
        to: [{ email: recipient }],
        subject,
        htmlContent,
        ...(env.EMAIL_REPLY_TO ? { replyTo: { email: env.EMAIL_REPLY_TO } } : {}),
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new EmailProviderError("brevo", response.status, body.code, body.message);
    }
    const body = (await response.json().catch(() => ({}))) as { messageId?: string };
    return { provider: "brevo", ...(body.messageId ? { messageId: body.messageId } : {}) };
  }
  sendPasswordReset(input: PasswordResetEmail) {
    return this.send(input.recipient, "Restablece tu contraseña de Fynar", resetHtml(input));
  }
  sendVerification(input: VerificationEmail) {
    return this.send(input.recipient, "Verifica tu correo de Fynar", verificationHtml(input));
  }
}

export class ResendEmailService implements EmailService {
  private readonly client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }
  private async send(recipient: string, subject: string, html: string) {
    const result = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to: recipient,
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      subject,
      html,
    });
    if (result.error) throw new Error(`RESEND_SEND_FAILED:${result.error.name}`);
  }
  sendPasswordReset(input: PasswordResetEmail) {
    return this.send(input.recipient, "Restablece tu contraseña de Fynar", resetHtml(input));
  }
  sendVerification(input: VerificationEmail) {
    return this.send(input.recipient, "Verifica tu correo de Fynar", verificationHtml(input));
  }
}

export class DevelopmentEmailService implements EmailService {
  private log(recipient: string, kind: string) {
    logger.info("Correo no enviado: proveedor de desarrollo", {
      recipientDomain: recipient.split("@")[1],
      kind,
    });
  }
  async sendPasswordReset({ recipient }: PasswordResetEmail) {
    this.log(recipient, "password-reset");
  }
  async sendVerification({ recipient }: VerificationEmail) {
    this.log(recipient, "email-verification");
  }
}

export const emailService: EmailService =
  env.EMAIL_PROVIDER === "brevo"
    ? new BrevoEmailService(env.BREVO_API_KEY as string)
    : env.EMAIL_PROVIDER === "resend"
      ? new ResendEmailService(env.RESEND_API_KEY as string)
      : new DevelopmentEmailService();
