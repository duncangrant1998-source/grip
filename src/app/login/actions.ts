"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { clearSessionCookie, readSessionId, setSessionCookie } from "@/lib/session";
import { withoutTenant } from "@/db/client";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
  shop: z.string().trim().max(60).optional(),
});

export type LoginState = {
  error?: string;
  needsShop?: boolean;
  email?: string;
};

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    shop: (form.get("shop") as string) || undefined,
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  const { email, password, shop } = parsed.data;
  const result = await authenticate(email, password, shop);

  if (!result.ok) {
    if (result.reason === "needs_shop") {
      return {
        needsShop: true,
        email,
        error: "That login exists at more than one shop. Enter your shop code.",
      };
    }
    if (result.reason === "suspended") {
      return { email, error: "This shop's account is no longer active. Contact support." };
    }
    // Same message for unknown email and wrong password, on purpose.
    return { email, error: "Incorrect email or password." };
  }

  const ttl = Number(process.env.SESSION_TTL_DAYS ?? 14);
  await setSessionCookie(result.sessionId, ttl);
  redirect("/app");
}

export async function logout() {
  const sessionId = await readSessionId();
  if (sessionId) {
    await withoutTenant((tx) => tx`SELECT grip.revoke_session(${sessionId})`);
  }
  await clearSessionCookie();
  redirect("/login");
}
