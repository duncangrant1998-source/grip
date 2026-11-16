"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";
import { withIdempotency, idemKeyFrom } from "@/lib/idempotency";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const optDate = z.preprocess((v) => (v === "" || v == null ? undefined : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").optional());
const optMoney = z.preprocess((v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().min(0, "Cost can't be negative.").max(1_000_000).optional());

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

function refresh(poId: string) {
  revalidatePath(`/app/parts/orders/${poId}`);
  revalidatePath("/app/parts/orders");
  revalidatePath("/app/parts");
}

export async function createPurchaseOrder(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ supplier_id: uuid, expected_at: optDate, tax_rate_id: optUuid })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Choose a supplier." };
  const o = parsed.data;
  const idemKey = idemKeyFrom(form);

  return runAction("purchaseOrders.manage", async (session) => {
    const { id } = await inShop(session, (tx) =>
      withIdempotency(tx, session.tenantId, "parts.createPurchaseOrder", idemKey, async () => {
        const [row] = await tx<{ id: string }[]>`
          SELECT grip.create_purchase_order(${o.supplier_id}, ${o.expected_at ?? null},
                                            ${o.tax_rate_id ?? null}) AS id`;
        return { id: row.id };
      }),
    );
    revalidatePath("/app/parts/orders");
    redirect(`/app/parts/orders/${id}`);
  });
}

export async function createReorder(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ supplier_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Unknown supplier." };
  const idemKey = idemKeyFrom(form);

  return runAction("purchaseOrders.manage", async (session) => {
    const { id } = await inShop(session, (tx) =>
      withIdempotency(tx, session.tenantId, "parts.createReorder", idemKey, async () => {
        const [row] = await tx<{ id: string }[]>`
          SELECT grip.create_reorder_po(${parsed.data.supplier_id}) AS id`;
        return { id: row.id };
      }),
    );
    revalidatePath("/app/parts/orders");
    revalidatePath("/app/parts/reorder");
    redirect(`/app/parts/orders/${id}`);
  });
}

export async function setPoOptions(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ po_id: uuid, expected_at: optDate, tax_rate_id: optUuid })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const o = parsed.data;

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_purchase_order_options(${o.po_id}, ${o.expected_at ?? null}, ${o.tax_rate_id ?? null})`);
    refresh(o.po_id);
  });
}

export async function addPoLine(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    po_id: uuid, part_id: uuid,
    qty: z.coerce.number({ invalid_type_error: "Enter a quantity." })
      .int("Whole numbers only.").min(1, "Quantity must be at least 1.").max(100_000),
    unit_cost: optMoney,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.add_purchase_order_line(${l.po_id}, ${l.part_id}, ${l.qty}, ${l.unit_cost ?? null})`);
    refresh(l.po_id);
  });
}

export async function updatePoLine(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    po_id: uuid, line_id: uuid,
    qty: z.coerce.number().int("Whole numbers only.").min(1, "Quantity must be at least 1.").max(100_000),
    unit_cost: z.coerce.number().min(0, "Cost can't be negative.").max(1_000_000),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.update_purchase_order_line(${l.line_id}, ${l.qty}, ${l.unit_cost})`);
    refresh(l.po_id);
  });
}

export async function removePoLine(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ po_id: uuid, line_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.remove_purchase_order_line(${parsed.data.line_id})`);
    refresh(parsed.data.po_id);
  });
}

export async function placePo(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ po_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.place_purchase_order(${parsed.data.po_id})`);
    refresh(parsed.data.po_id);
  });
}

export async function cancelPo(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ po_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.cancel_purchase_order(${parsed.data.po_id})`);
    refresh(parsed.data.po_id);
  });
}

/**
 * Receive against one or more lines in a single delivery. Each field is named
 * `recv_<lineId>`; blank or zero means "none of this line arrived". The whole
 * delivery is one transaction, so a bad quantity on the third line leaves the
 * first two unreceived rather than half-booked.
 */
export async function receiveDelivery(_prev: ActionState, form: FormData): Promise<ActionState> {
  const poId = uuid.safeParse(form.get("po_id"));
  if (!poId.success) return { error: "Unknown purchase order." };

  const items: { lineId: string; qty: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("recv_")) continue;
    const lineId = uuid.safeParse(key.slice(5));
    if (!lineId.success) continue;
    const raw = String(value).trim();
    if (raw === "") continue;
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty < 0) return { error: "Quantities received must be whole numbers." };
    if (qty > 0) items.push({ lineId: lineId.data, qty });
  }
  if (items.length === 0) return { error: "Enter how many of at least one item arrived." };

  return runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, async (tx) => {
      for (const it of items) {
        await tx`SELECT grip.receive_purchase_order_line(${it.lineId}, ${it.qty}, ${session.userId})`;
      }
    });
    refresh(poId.data);
    revalidatePath("/app/orders");
  });
}
