"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop, requirePlatformAdmin } from "@/lib/auth";
import type { ActionState } from "@/lib/action";

const statusEnum = z.enum(["open", "in_progress", "resolved"]);

export async function setSupportRequestStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: z.string().uuid(), status: statusEnum }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the form and try again." };

  try {
    const session = await requirePlatformAdmin();
    await inShop(session, (tx) => tx`
      SELECT grip.set_support_request_status(${parsed.data.id}, ${parsed.data.status}::grip.support_request_status)`);
    revalidatePath("/platform/support");
    revalidatePath("/platform/notifications");
    return { ok: true, nonce: Date.now() };
  } catch (err) {
    console.error("setSupportRequestStatus failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
