"use server";

import { createHash } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withoutTenant } from "@/db/client";

export type ResetState = { error?: string };

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "A password needs at least 8 characters.").max(200),
  confirm: z.string(),
});

export async function completePasswordReset(_prev: ResetState, form: FormData): Promise<ResetState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { token, password, confirm } = parsed.data;
  if (password !== confirm) return { error: "The new passwords don't match." };

  const passwordHash = await hash(password);

  try {
    await withoutTenant(
      (tx) => tx`SELECT grip.complete_password_reset(${hashToken(token)}, ${passwordHash})`,
    );
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "P0001" || e.code === "23514") {
      return { error: "This reset link is invalid or has expired. Request a new one." };
    }
    console.error("completePasswordReset failed:", err);
    return { error: "Something went wrong. Please try again." };
  }

  redirect("/login?changed=1");
}
