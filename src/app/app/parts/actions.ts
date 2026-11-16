"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const money = z.coerce.number({ invalid_type_error: "Enter an amount." }).min(0, "Can't be negative.").max(1_000_000);
const whole = (max: number) =>
  z.coerce.number({ invalid_type_error: "Enter a whole number." })
    .int("Whole numbers only.").min(0, "Can't be negative.").max(max);
const optText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => v || null);
const checked = z.preprocess((v) => v === "on" || v === "true", z.boolean());

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

const partFields = {
  sku: z.string().trim().min(1, "A part needs a SKU.").max(60),
  description: z.string().trim().min(1, "A part needs a description.").max(200),
  category: optText(60),
  subcategory: optText(60),
  fitment: optText(300),
  bin_location: optText(40),
  unit_cost: money,
  unit_price: money,
  reorder_point: whole(100_000),
  reorder_qty: whole(100_000),
  supplier_id: optUuid,
  is_stocked: checked,
};

// --- parts -------------------------------------------------------------------------

/**
 * "Add a new supplier…" in the supplier dropdown posts the sentinel below along
 * with the new supplier's details, so a part can be added without leaving the form.
 */
const NEW_SUPPLIER = "__new__";

function newSupplierFrom(raw: Record<string, FormDataEntryValue>) {
  const parsed = z.object({
    name: z.string().trim().min(1, "Give the new supplier a name.").max(120),
    phone: optText(40),
    email: supplierFields.email,
    lead_time_days: whole(365),
  }).safeParse({
    name: raw.new_supplier_name ?? "", phone: raw.new_supplier_phone ?? "",
    email: raw.new_supplier_email ?? "", lead_time_days: raw.new_supplier_lead ?? "2",
  });
  return parsed;
}

export async function createPart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(form);
  const wantsNewSupplier = raw.supplier_id === NEW_SUPPLIER;
  const parsed = z.object({ ...partFields, opening_qty: whole(1_000_000).optional() })
    .safeParse({ ...raw, supplier_id: wantsNewSupplier ? "" : raw.supplier_id });
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  const ns = wantsNewSupplier ? newSupplierFrom(raw) : null;
  if (ns && !ns.success) return bad(ns);

  const result = await runAction("inventory.edit", async (session) => {
    const id = await inShop(session, async (tx) => {
      let supplierId = p.supplier_id ?? null;
      if (ns && ns.success) {
        const [sup] = await tx<{ id: string }[]>`
          INSERT INTO grip.suppliers (tenant_id, name, phone, email, lead_time_days)
          VALUES (${session.tenantId}, ${ns.data.name}, ${ns.data.phone}, ${ns.data.email},
                  ${ns.data.lead_time_days})
          RETURNING id`;
        supplierId = sup.id;
      }

      const [row] = await tx<{ id: string }[]>`
        INSERT INTO grip.parts
          (tenant_id, sku, description, category, subcategory, fitment, bin_location, unit_cost, unit_price,
           reorder_point, reorder_qty, supplier_id, is_stocked)
        VALUES
          (${session.tenantId}, ${p.sku}, ${p.description}, ${p.category}, ${p.subcategory}, ${p.fitment},
           ${p.bin_location}, ${p.unit_cost}, ${p.unit_price}, ${p.reorder_point}, ${p.reorder_qty},
           ${supplierId}, ${p.is_stocked})
        RETURNING id`;

      await tx`INSERT INTO grip.part_stock (part_id, tenant_id) VALUES (${row.id}, ${session.tenantId})`;
      if (p.opening_qty && p.opening_qty > 0) {
        await tx`SELECT grip.adjust_stock(${row.id}, ${p.opening_qty}, 'Opening stock', ${session.userId})`;
      }
      await tx`SELECT grip.log_audit('part.created', 'part', ${row.id},
        ${tx.json({ sku: p.sku, description: p.description })})`;
      return row.id;
    });
    revalidatePath("/app/parts");
    redirect(`/app/parts/${id}`);
  });
  // A duplicate supplier name and a duplicate SKU both come back as "already exists".
  if (result.error === "That already exists.") {
    return { error: wantsNewSupplier
      ? "A part with that SKU already exists, or you already have a supplier with that name."
      : "A part with that SKU already exists." };
  }
  return result;
}

export async function updatePart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(form);
  const wantsNewSupplier = raw.supplier_id === NEW_SUPPLIER;
  const parsed = z.object({ id: uuid, ...partFields })
    .safeParse({ ...raw, supplier_id: wantsNewSupplier ? "" : raw.supplier_id });
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  const ns = wantsNewSupplier ? newSupplierFrom(raw) : null;
  if (ns && !ns.success) return bad(ns);

  const result = await runAction("inventory.edit", async (session) => {
    await inShop(session, async (tx) => {
      let supplierId = p.supplier_id ?? null;
      if (ns && ns.success) {
        const [sup] = await tx<{ id: string }[]>`
          INSERT INTO grip.suppliers (tenant_id, name, phone, email, lead_time_days)
          VALUES (${session.tenantId}, ${ns.data.name}, ${ns.data.phone}, ${ns.data.email},
                  ${ns.data.lead_time_days})
          RETURNING id`;
        supplierId = sup.id;
      }

      const [before] = await tx<{ unit_cost: string; unit_price: string; sku: string }[]>`
        SELECT unit_cost, unit_price, sku FROM grip.parts WHERE id = ${p.id}`;
      if (!before) throw Object.assign(new Error("Part not found."), { code: "P0001" });

      await tx`
        UPDATE grip.parts SET
          sku = ${p.sku}, description = ${p.description}, category = ${p.category},
          subcategory = ${p.subcategory}, fitment = ${p.fitment}, bin_location = ${p.bin_location}, unit_cost = ${p.unit_cost}, unit_price = ${p.unit_price},
          reorder_point = ${p.reorder_point}, reorder_qty = ${p.reorder_qty},
          supplier_id = ${supplierId}, is_stocked = ${p.is_stocked}
        WHERE id = ${p.id}`;

      // Price and cost changes matter for margin, so they leave a trail.
      if (Number(before.unit_price) !== p.unit_price || Number(before.unit_cost) !== p.unit_cost) {
        await tx`SELECT grip.log_audit('part.repriced', 'part', ${p.id}, ${tx.json({
          price: { from: Number(before.unit_price), to: p.unit_price },
          cost: { from: Number(before.unit_cost), to: p.unit_cost },
        })})`;
      }
    });
    revalidatePath(`/app/parts/${p.id}`);
    revalidatePath("/app/parts");
  });
  return result.error === "That already exists." ? { error: "Another part already uses that SKU." } : result;
}

export async function archivePart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("inventory.edit", async (session) => {
    await inShop(session, async (tx) => {
      const [s] = await tx<{ qty_on_hand: number; qty_reserved: number; qty_on_order: number }[]>`
        SELECT qty_on_hand, qty_reserved, qty_on_order FROM grip.part_stock
        WHERE part_id = ${parsed.data.id}`;
      if (s && (s.qty_on_hand !== 0 || s.qty_reserved !== 0 || s.qty_on_order !== 0)) {
        throw Object.assign(
          new Error("Only a part with nothing on hand, reserved or on order can be archived."),
          { code: "P0001" });
      }
      await tx`UPDATE grip.parts SET is_active = false WHERE id = ${parsed.data.id}`;
      await tx`SELECT grip.log_audit('part.archived', 'part', ${parsed.data.id})`;
    });
    revalidatePath("/app/parts");
    redirect("/app/parts");
  });
}

// --- stock -------------------------------------------------------------------------

export async function adjustStock(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    part_id: uuid,
    delta: z.coerce.number({ invalid_type_error: "Enter a whole number." })
      .int("Whole numbers only.").refine((n) => n !== 0, "Enter a change other than zero.")
      .refine((n) => Math.abs(n) <= 1_000_000, "That's too large."),
    reason: z.string().trim().min(1, "Say why you're adjusting stock.").max(200),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const a = parsed.data;

  return runAction("inventory.edit", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.adjust_stock(${a.part_id}, ${a.delta}, ${a.reason}, ${session.userId})`);
    revalidatePath(`/app/parts/${a.part_id}`);
    revalidatePath("/app/parts");
  });
}

export async function countStock(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    part_id: uuid,
    counted: whole(1_000_000),
    note: optText(200),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const c = parsed.data;

  return runAction("inventory.edit", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.count_stock(${c.part_id}, ${c.counted}, ${c.note})`);
    revalidatePath(`/app/parts/${c.part_id}`);
    revalidatePath("/app/parts");
  });
}

// --- suppliers ---------------------------------------------------------------------

const supplierFields = {
  name: z.string().trim().min(1, "A supplier needs a name.").max(120),
  account_no: optText(60),
  phone: optText(40),
  email: z.string().trim().max(254).optional().transform((v) => v || null)
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "That email doesn't look right."),
  lead_time_days: whole(365),
  address_line1: optText(120),
  city: optText(80),
  region: optText(40),
  postal_code: optText(20),
  hours: optText(300),
  delivery_notes: optText(1000),
};

export async function createSupplier(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object(supplierFields).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  const result = await runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`
      INSERT INTO grip.suppliers
        (tenant_id, name, account_no, phone, email, lead_time_days,
         address_line1, city, region, postal_code, hours, delivery_notes)
      VALUES (${session.tenantId}, ${s.name}, ${s.account_no}, ${s.phone}, ${s.email}, ${s.lead_time_days},
              ${s.address_line1}, ${s.city}, ${s.region}, ${s.postal_code}, ${s.hours}, ${s.delivery_notes})`);
    revalidatePath("/app/parts/suppliers");
  });
  return result.error === "That already exists." ? { error: "You already have a supplier with that name." } : result;
}

export async function updateSupplier(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, ...supplierFields, is_active: checked })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  const result = await runAction("purchaseOrders.manage", async (session) => {
    await inShop(session, (tx) => tx`
      UPDATE grip.suppliers SET name = ${s.name}, account_no = ${s.account_no}, phone = ${s.phone},
        email = ${s.email}, lead_time_days = ${s.lead_time_days}, is_active = ${s.is_active},
        address_line1 = ${s.address_line1}, city = ${s.city}, region = ${s.region},
        postal_code = ${s.postal_code}, hours = ${s.hours}, delivery_notes = ${s.delivery_notes}
      WHERE id = ${s.id}`);
    revalidatePath("/app/parts/suppliers");
  });
  return result.error === "That already exists." ? { error: "You already have a supplier with that name." } : result;
}
