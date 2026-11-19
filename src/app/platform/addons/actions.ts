"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop, requirePlatformAdmin } from "@/lib/auth";
import type { ActionState } from "@/lib/action";

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

/**
 * The only path that ever moves a shop's add-on row to 'active' or
 * 'suspended' — RLS (0027) rejects that write from anyone but a platform
 * admin, so this works only because requirePlatformAdmin() below actually
 * put the session's app.is_platform_admin flag on.
 */
export async function setAddonStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    tenant_id: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  try {
    const session = await requirePlatformAdmin();
    await inShop(session, (tx) => tx`
      INSERT INTO grip.shop_addons (tenant_id, addon_key, status, granted_by, granted_at)
      VALUES (${p.tenant_id}, 'client_messaging'::grip.addon_key, ${p.status}::grip.addon_status,
              ${session.userId}, now())
      ON CONFLICT (tenant_id, addon_key) DO UPDATE SET
        status = EXCLUDED.status, granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at`);
    revalidatePath("/platform/addons");
    return { ok: true, nonce: Date.now() };
  } catch (err) {
    console.error("setAddonStatus failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
