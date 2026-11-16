"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

function refresh(id: string) {
  revalidatePath(`/app/parts/sales/${id}`);
  revalidatePath("/app/parts/sales");
  revalidatePath("/app/parts");
}

export async function startSale(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    customer_id: optUuid,
    customer_name: z.string().trim().max(120).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("counterSales.create", async (session) => {
    const [row] = await inShop(session, (tx) => tx<{ id: string }[]>`
      SELECT grip.create_counter_sale(${s.customer_id ?? null}, ${s.customer_name ?? null}) AS id`);
    revalidatePath("/app/parts/sales");
    redirect(`/app/parts/sales/${row.id}`);
  });
}

export async function addSaleLine(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    sale_id: uuid, part_id: uuid,
    qty: z.coerce.number({ invalid_type_error: "Enter a quantity." })
      .int("Whole numbers only.").min(1, "Quantity must be at least 1.").max(9999),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${l.sale_id}, ${l.part_id}, ${l.qty}, ${session.userId})`);
    refresh(l.sale_id);
  });
}

export async function removeSaleLine(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ sale_id: uuid, line_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.remove_counter_sale_line(${parsed.data.line_id})`);
    refresh(parsed.data.sale_id);
  });
}

export async function setSaleTax(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ sale_id: uuid, tax_rate_id: optUuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_counter_sale_tax(${parsed.data.sale_id}, ${parsed.data.tax_rate_id ?? null})`);
    refresh(parsed.data.sale_id);
  });
}

export async function completeSale(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ sale_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.complete_counter_sale(${parsed.data.sale_id})`);
    refresh(parsed.data.sale_id);
  });
}

export async function cancelSale(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ sale_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.cancel_counter_sale(${parsed.data.sale_id})`);
    refresh(parsed.data.sale_id);
  });
}

/** Why this sale carries no HST. Required before an exempt sale can be completed. */
export async function setSaleExemption(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    sale_id: uuid,
    reason: z.preprocess((v) => (v === "" || v == null ? undefined : v),
      z.enum(["status_card", "government", "resale", "export", "internal", "other"]).optional()),
    reference: z.string().trim().max(60).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const e = parsed.data;

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_counter_sale_exemption(${e.sale_id},
        ${e.reason ?? null}::grip.exempt_reason, ${e.reference ?? null})`);
    refresh(e.sale_id);
  });
}

/** Tax on or off for one part on a counter sale. */
export async function setSaleLineTaxable(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    sale_id: uuid, line_id: uuid,
    taxable: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.set_counter_sale_line_taxable(${l.line_id}, ${l.taxable})`);
    refresh(l.sale_id);
  });
}

/** Moves a sale already under way to a customer on file, or to a named walk-in. */
export async function changeSaleCustomer(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    sale_id: uuid,
    customer_id: optUuid,
    customer_name: z.string().trim().max(120).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const c = parsed.data;

  return runAction("counterSales.create", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_counter_sale_customer(${c.sale_id}, ${c.customer_id ?? null}, ${c.customer_name ?? null})`);
    refresh(c.sale_id);
    redirect(`/app/parts/sales/${c.sale_id}`);
  });
}
