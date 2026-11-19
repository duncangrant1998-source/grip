"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, type ActionState } from "@/lib/action";

/**
 * Gated by settings.manage, same as the rest of My Shop — layout.tsx already
 * enforces that for this whole route. grip.request_addon only ever sets
 * status to 'requested'; RLS (0027) backs that up at the database level, so
 * this can never actually turn the add-on on even if the permission check
 * here were somehow bypassed.
 */
export async function requestClientMessagingAddon(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ note: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the form and try again." };

  return runAction("settings.manage", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.request_addon('client_messaging'::grip.addon_key, ${parsed.data.note || null})`);
    revalidatePath("/app/shop/addons");
  });
}
