"use server";

import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { inShop, requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSessionCookie } from "@/lib/session";
import { runAction, type ActionState } from "@/lib/action";
import { grantSupportAccess, revokeSupportAccess } from "@/lib/platform-queries";

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

export async function submitSupportRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    subject: z.string().trim().min(1, "Enter a subject.").max(120),
    message: z.string().trim().min(1, "Enter a message.").max(4000),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const session = await requireSession();
  await inShop(session, (tx) => tx`
    SELECT grip.create_support_request(${parsed.data.subject}, ${parsed.data.message})`);
  revalidatePath("/app/account");
  return { ok: true, nonce: Date.now() };
}

const supportAccessHours = z.coerce.number().int().min(1).max(168);

/** Opens this shop's account to GRIP support for a limited, chosen window. */
export async function grantAccess(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    hours: supportAccessHours,
    support_request_id: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
    note: z.string().trim().max(300).optional().transform((v) => v || null),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const a = parsed.data;

  return runAction("supportAccess.manage", async (session) => {
    await grantSupportAccess(session, a.hours, a.support_request_id ?? null, a.note);
    revalidatePath("/app/account");
  });
}

export async function revokeAccess(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the form." };

  return runAction("supportAccess.manage", async (session) => {
    await revokeSupportAccess(session, parsed.data.id);
    revalidatePath("/app/account");
  });
}
