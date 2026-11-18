"use server";

import { randomBytes, createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { withoutTenant } from "@/db/client";
import { sendPasswordResetEmail } from "@/lib/notify";

export type ForgotState = { done?: boolean; error?: string };

const schema = z.object({ email: z.string().trim().email().max(254) });

/** sha256 is plenty for a 256-bit random token — the slowness argon2 buys for a
 *  human-chosen password defends against nothing here; nobody is guessing this. */
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

function originFrom(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Always resolves the same way regardless of whether the email matches an
 * account — same reasoning as the dummy-hash check in authenticate(): a
 * forgot-password form is also a place to enumerate which emails have
 * accounts, if it answers differently when they don't.
 *
 * The same email can have a login at more than one shop (login's own
 * "needs_shop" case), so this issues one token and sends one email per
 * matching, active account rather than guessing which shop was meant.
 */
export async function requestPasswordReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const parsed = schema.safeParse({ email: form.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };
  const { email } = parsed.data;

  const candidates = await withoutTenant(
    (tx) => tx<{ user_id: string; full_name: string; tenant_name: string }[]>`
      SELECT user_id, full_name, tenant_name FROM grip.find_users_for_login(${email})`,
  );

  const origin = originFrom(await headers());

  for (const c of candidates) {
    const rawToken = randomBytes(32).toString("base64url");
    const [{ create_password_reset: issued }] = await withoutTenant(
      (tx) => tx<{ create_password_reset: boolean }[]>`
        SELECT grip.create_password_reset(${c.user_id}, ${hashToken(rawToken)}, 30)`,
    );
    if (!issued) continue; // rate-limited: this account already has several live requests

    await sendPasswordResetEmail({
      to: email,
      fullName: c.full_name,
      tenantName: c.tenant_name,
      resetUrl: `${origin}/login/reset?token=${rawToken}`,
    });
  }

  return { done: true };
}
