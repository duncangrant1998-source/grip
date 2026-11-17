"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop, requirePlatformAdmin } from "@/lib/auth";
import type { ActionState } from "@/lib/action";

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

const optDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().optional());
const optText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => v || null);

export async function recordPayment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    tenant_id: z.string().uuid(),
    amount: z.coerce.number().min(0, "Can't be negative.").max(100_000),
    status: z.enum(["paid", "due", "overdue", "waived"]),
    period_start: optDate,
    period_end: optDate,
    due_date: optDate,
    note: optText(500),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  try {
    const session = await requirePlatformAdmin();
    await inShop(session, (tx) => tx`
      INSERT INTO grip.payments
        (tenant_id, amount, status, period_start, period_end, due_date, note,
         paid_at, created_by_user_id)
      VALUES
        (${p.tenant_id}, ${p.amount}, ${p.status}::grip.payment_status,
         ${p.period_start ?? null}, ${p.period_end ?? null}, ${p.due_date ?? null}, ${p.note},
         CASE WHEN ${p.status} = 'paid' THEN now() ELSE NULL END, ${session.userId})`);
    revalidatePath("/platform/payments");
    return { ok: true, nonce: Date.now() };
  } catch (err) {
    console.error("recordPayment failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function updatePaymentStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    id: z.string().uuid(),
    status: z.enum(["paid", "due", "overdue", "waived"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  try {
    const session = await requirePlatformAdmin();
    await inShop(session, (tx) => tx`
      UPDATE grip.payments
      SET status = ${p.status}::grip.payment_status,
          paid_at = CASE WHEN ${p.status} = 'paid' THEN now() ELSE NULL END
      WHERE id = ${p.id}`);
    revalidatePath("/platform/payments");
    return { ok: true, nonce: Date.now() };
  } catch (err) {
    console.error("updatePaymentStatus failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
