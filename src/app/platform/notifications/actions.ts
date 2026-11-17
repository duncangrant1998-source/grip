"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop, requirePlatformAdmin } from "@/lib/auth";
import type { ActionState } from "@/lib/action";

export async function markNotificationRead(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the form and try again." };

  const session = await requirePlatformAdmin();
  await inShop(session, (tx) => tx`SELECT grip.mark_notification_read(${parsed.data.id})`);
  revalidatePath("/platform/notifications");
  revalidatePath("/platform");
  return { ok: true, nonce: Date.now() };
}

export async function markAllNotificationsRead(_prev: ActionState): Promise<ActionState> {
  const session = await requirePlatformAdmin();
  await inShop(session, (tx) => tx`SELECT grip.mark_all_notifications_read()`);
  revalidatePath("/platform/notifications");
  revalidatePath("/platform");
  return { ok: true, nonce: Date.now() };
}
