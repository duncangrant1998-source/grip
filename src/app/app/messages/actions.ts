"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop, requireSession } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const body = z.string().trim().min(1, "Write something before sending.").max(4000);

/**
 * Sends to whichever coworker was picked and lands on their (possibly new)
 * thread. No `permission` is passed to runAction — messaging a coworker
 * isn't gated by the role matrix in permissions.ts, it's open to anyone
 * signed in at the shop. `grip.send_message` is where the real checks live
 * (same tenant, active, not yourself).
 */
export async function sendNewMessage(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ recipient_id: uuid, body }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { recipient_id, body: text } = parsed.data;

  return runAction(null, async (session) => {
    const [row] = await inShop(session, (tx) => tx<{ send_message: string }[]>`
      SELECT grip.send_message(${recipient_id}, ${text})`);
    const [thread] = await inShop(session, (tx) => tx<{ id: string }[]>`
      SELECT thread_id AS id FROM grip.messages WHERE id = ${row.send_message}`);
    revalidatePath("/app/messages");
    redirect(`/app/messages/${thread.id}`);
  });
}

export async function sendReply(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ recipient_id: uuid, thread_id: uuid, body }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { recipient_id, thread_id, body: text } = parsed.data;

  return runAction(null, async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.send_message(${recipient_id}, ${text})`);
    revalidatePath("/app/messages");
    revalidatePath(`/app/messages/${thread_id}`);
  });
}

/** Fire-and-forget: called once when a thread's page loads (see [id]/page.tsx). */
export async function markThreadRead(threadId: string): Promise<void> {
  const session = await requireSession();
  await inShop(session, (tx) => tx`SELECT grip.mark_thread_read(${threadId})`);
  revalidatePath("/app/messages");
}
