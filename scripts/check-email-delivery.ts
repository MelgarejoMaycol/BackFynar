import "dotenv/config";

const identifier = process.argv[2];
if (!identifier) throw new Error("Uso: npx tsx scripts/check-email-delivery.ts <correo|messageId>");

const apiKey = process.env.BREVO_API_KEY;
if (!apiKey) throw new Error("BREVO_API_KEY no esta configurada");

const query = new URLSearchParams({ limit: "50", sort: "desc" });
if (/^\S+@\S+\.\S+$/.test(identifier)) query.set("email", identifier);
else query.set("messageId", identifier);

const response = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${query}`, {
  headers: { "api-key": apiKey, accept: "application/json" },
});
const body = (await response.json().catch(() => ({}))) as {
  code?: string;
  message?: string;
  events?: Array<{
    date?: string;
    email?: string;
    event?: string;
    messageId?: string;
    reason?: string;
  }>;
};

if (!response.ok) {
  console.error(
    JSON.stringify({
      success: false,
      status: response.status,
      code: body.code,
      message: body.message,
    }),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      success: true,
      events: (body.events ?? []).map(({ date, email, event, messageId, reason }) => ({
        date,
        recipientDomain: email?.split("@")[1],
        event,
        messageId,
        ...(reason ? { reason } : {}),
      })),
    }),
  );
}
