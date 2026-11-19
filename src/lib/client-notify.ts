import "server-only";

/**
 * Best-effort outbound to a customer — email via Resend's HTTP API, SMS via
 * Twilio's. Both are optional on purpose: this is the client-messaging add-on's
 * send path, wired up now per Duncan's request, with no provider account set
 * up yet. Every call below returns { sent: false, reason } rather than
 * throwing when its env vars are missing, so grip.send_client_message's
 * 'queued' row is always written first and this just decides whether it
 * becomes 'sent' or 'failed' — turning the feature "on" for real, later,
 * is only ever an env-var change (see .env.example), never a code change.
 *
 * Kept separate from src/lib/notify.ts (the platform console's own emails):
 * that one speaks for Grip-the-company; this one speaks for a shop, to its
 * own customer, so it needs its own sending identity — see
 * CLIENT_MESSAGING_RESEND_FROM below — even though it can reuse the same
 * Resend account/API key until each shop gets its own.
 */

export type SendResult = { sent: boolean; reason?: string };

async function sendClientEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CLIENT_MESSAGING_RESEND_FROM;
  if (!apiKey || !from) {
    return { sent: false, reason: "Email to customers isn't configured for this shop yet." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      console.error("sendClientEmail: Resend returned", res.status, await res.text().catch(() => ""));
      return { sent: false, reason: "The email provider rejected the message." };
    }
    return { sent: true };
  } catch (err) {
    console.error("sendClientEmail failed:", err);
    return { sent: false, reason: "Could not reach the email provider." };
  }
}

async function sendClientSms(to: string, body: string): Promise<SendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // A Messaging Service SID (recommended — supports a shared sender pool) or
  // a single From number, whichever this shop/Grip ends up provisioned with.
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !(messagingServiceSid || fromNumber)) {
    return { sent: false, reason: "Texting customers isn't configured for this shop yet." };
  }

  try {
    const params = new URLSearchParams({
      To: to,
      Body: body,
      ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: fromNumber! }),
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!res.ok) {
      console.error("sendClientSms: Twilio returned", res.status, await res.text().catch(() => ""));
      return { sent: false, reason: "The text provider rejected the message." };
    }
    return { sent: true };
  } catch (err) {
    console.error("sendClientSms failed:", err);
    return { sent: false, reason: "Could not reach the text provider." };
  }
}

export async function sendClientMessage(input: {
  channel: "email" | "sms";
  to: string;
  body: string;
  subject?: string;
}): Promise<SendResult> {
  return input.channel === "email"
    ? sendClientEmail(input.to, input.subject ?? "An update on your vehicle", input.body)
    : sendClientSms(input.to, input.body);
}
