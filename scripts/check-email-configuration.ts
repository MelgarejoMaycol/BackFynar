import "dotenv/config";

const apiKey = process.env.BREVO_API_KEY;
if (!apiKey) throw new Error("BREVO_API_KEY no esta configurada");

const response = await fetch("https://api.brevo.com/v3/senders", {
  headers: { "api-key": apiKey, accept: "application/json" },
});
const body = (await response.json().catch(() => ({}))) as {
  code?: string;
  message?: string;
  senders?: Array<{ active?: boolean; email?: string; id?: number; name?: string }>;
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
  const configuredFrom = process.env.EMAIL_FROM ?? "";
  const configuredEmail = /<([^>]+)>/.exec(configuredFrom)?.[1] ?? configuredFrom;
  console.log(
    JSON.stringify({
      success: true,
      configuredSender: configuredEmail,
      configuredSenderIsActive: body.senders?.some(
        ({ active, email }) => active && email?.toLowerCase() === configuredEmail.toLowerCase(),
      ),
      availableSenders: (body.senders ?? []).map(({ active, email, id, name }) => ({
        active,
        email,
        id,
        name,
      })),
    }),
  );
}
