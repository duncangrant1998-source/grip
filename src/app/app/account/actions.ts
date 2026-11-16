"use server";

import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { inShop, requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/lib/session";
import type { ActionState } from "@/lib/action";

export async function changePassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(8, "A new password needs at least 8 characters.").max(200),
    confirm: z.string(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { current, next, confirm } = parsed.data;
  if (next !== confirm) return { error: "The new passwords don't match." };
  if (next === current) return { error: "Choose a password you haven't used here." };

  const session = await requireSession();

  const [row] = await inShop(session, (tx) => tx<{ password_hash: string }[]>`
    SELECT password_hash FROM grip.users WHERE id = ${session.userId}`);
  if (!row || !(await verify(row.password_hash, current).catch(() => false))) {
    return { error: "Your current password isn't right." };
  }

  const newHash = await hash(next);
  await inShop(session, (tx) => tx`SELECT grip.set_user_password(${session.userId}, ${newHash})`);

  // Changing a password signs the account out everywhere, this browser included.
  await clearSessionCookie();
  redirect("/login?changed=1");
}
