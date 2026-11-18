import "server-only";

/**
 * Best-effort email, sent through Resend's plain HTTP API with the runtime's
 * built-in `fetch` — deliberately dependency-free, since no Resend SDK is
 * installed (this environment cannot run `npm install`). Any other
 * transactional-email provider with an HTTP API would drop in the same way.
 *
 * Shared by two callers with different jobs:
 *   - emailPlatformAdmin  — the platform console's notification feed (support
 *     requests, security events). The in-app record (grip.platform_notifications)
 *     is written by the database functions in 0022 and is the source of
 *     truth regardless of whether this ever sends.
 *   - sendPasswordResetEmail — the one piece of outbound mail that actually
 *     has to arrive for the feature to work (0024's self-service reset).
 *     There is no in-app fallback if this silently no-ops, so a send failure
 *     here is also reported to the platform admin via emailPlatformAdmin.
 *
 * Needs RESEND_API_KEY and a verified sending address, neither of which are
 * set by default — see .env.example. Until they're set, both callers below
 * are silent no-ops: the console and its notification bell still work, and
 * requesting a reset link always returns the same generic confirmation either
 * way (see login/forgot/actions.ts) — only the email itself goes missing.
 */
async function sendViaResend(input: { to: string; subject: string; text: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PLATFORM_NOTIFY_FROM;
  if (!apiKey || !from) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text }),
    });
    if (!res.ok) {
      console.error("sendViaResend: Resend returned", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendViaResend failed:", err);
    return false;
  }
}

export async function emailPlatformAdmin(input: { title: string; body: string }): Promise<void> {
  const to = process.env.PLATFORM_NOTIFY_TO;
  if (!to) return;
  await sendViaResend({ to, subject: `[Grip] ${input.title}`, text: input.body });
}

/**
 * One email per matched account (login/forgot/actions.ts sends one of these
 * per shop when the same address has a login at more than one). The link
 * carries the only copy of the raw token that will ever exist outside the
 * person's inbox — the database only ever sees its hash.
 */
export async function sendPasswordResetEmail(input: {
  to: string;
  fullName: string;
  tenantName: string;
  resetUrl: string;
}): Promise<void> {
  const sent = await sendViaResend({
    to: input.to,
    subject: `Reset your Grip password — ${input.tenantName}`,
    text:
      `Hi ${input.fullName},\n\n` +
      `Someone asked to reset the password for your Grip login at ${input.tenantName}. ` +
      `If that was you, set a new password here (this link works once and expires in 30 minutes):\n\n` +
      `${input.resetUrl}\n\n` +
      `If you didn't request this, you can ignore this email — your password hasn't changed.`,
  });

  if (!sent) {
    await emailPlatformAdmin({
      title: "Password-reset email failed to send",
      body: `A reset link for ${input.to} (${input.tenantName}) was requested but could not be emailed. ` +
        `Check RESEND_API_KEY / PLATFORM_NOTIFY_FROM.`,
    });
  }
}
