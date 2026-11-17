import "server-only";

/**
 * Best-effort email for the platform console's notification feed.
 *
 * The in-app record (grip.platform_notifications) is written by the database
 * functions in 0022 and is the source of truth — it exists whether or not
 * this ever sends. Email is a convenience on top so the operator hears about
 * a support request or security event without having the console open.
 *
 * Deliberately dependency-free: no Resend SDK is installed (this environment
 * cannot run `npm install`), so this calls Resend's plain HTTP API with the
 * runtime's built-in `fetch`. Any other transactional-email provider with an
 * HTTP API would drop in the same way.
 *
 * Needs three env vars, none of which are set yet:
 *   RESEND_API_KEY        — from a Resend account of GRIP's own (see the note
 *                            in .env.example — do not reuse another project's)
 *   PLATFORM_NOTIFY_FROM  — a verified sending address on that domain,
 *                            e.g. notifications@gripshopos.com
 *   PLATFORM_NOTIFY_TO    — where the alert should land, e.g.
 *                            admin@gripshopos.com
 * Until all three are set this is a silent no-op — the console and its
 * notification bell work regardless.
 */
export async function emailPlatformAdmin(input: { title: string; body: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PLATFORM_NOTIFY_FROM;
  const to = process.env.PLATFORM_NOTIFY_TO;
  if (!apiKey || !from || !to) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[Grip] ${input.title}`,
        text: input.body,
      }),
    });
    if (!res.ok) {
      console.error("emailPlatformAdmin: Resend returned", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    // Never let a notification email failure break the request that
    // triggered it — the in-app notification already exists.
    console.error("emailPlatformAdmin failed:", err);
  }
}
