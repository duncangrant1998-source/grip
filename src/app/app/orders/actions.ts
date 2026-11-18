"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";
import { can, canTransition, type WorkOrderStatus } from "@/lib/permissions";
import { canSeeOrder, ownEmployeeId } from "@/lib/queries";

const uuid = z.string().uuid();
const num = (max: number) =>
  z.coerce.number({ invalid_type_error: "Enter a number." }).finite().min(0, "Can't be negative.").max(max);
const optNum = (max: number) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), num(max).optional());
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const checked = z.preprocess((v) => v === "on" || v === "true", z.boolean());

function bad(parsed: { success: false; error: z.ZodError }): ActionState {
  return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
}

function refresh(orderId: string) {
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/orders");
}

export async function createOrder(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    customer_id: uuid,
    vehicle_id: uuid,
    concern: z.string().trim().max(2000).optional(),
    mileage_in: z.preprocess((v) => (v === "" || v == null ? undefined : String(v).replace(/[,\s]|km$/gi, "")),
      z.coerce.number({ invalid_type_error: "Mileage is a number, like 128400." })
        .int("Mileage is a whole number.").min(0).max(3_000_000).optional()),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const bad = parsed.error.issues[0];
    // Only a missing customer or vehicle is that; anything else names its own field.
    return { error: ["customer_id", "vehicle_id"].includes(String(bad?.path[0]))
      ? "Choose a customer and a vehicle."
      : bad?.message ?? "Check the form and try again." };
  }
  const o = parsed.data;

  return runAction("workorders.create", async (session) => {
    const [row] = await inShop(session, (tx) => tx<{ create_work_order: string }[]>`
      SELECT grip.create_work_order(${o.customer_id}, ${o.vehicle_id},
                                    ${o.concern ?? null}, ${o.mileage_in ?? null})`);
    revalidatePath("/app/orders");
    redirect(`/app/orders/${row.create_work_order}`);
  });
}

// --- lines: either desk may add to the same order ------------------------------

export async function addLabour(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    description: z.string().trim().min(1, "Describe the work.").max(300),
    hours: num(999),
    actual_hours: optNum(999),
    rate: optNum(10_000),
    mode: z.enum(["flat_rate", "straight_time"]).optional(),
    tech_id: optUuid,
    taxable: checked,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("workorders.addLabour", async (session) => {
    if (!(await canSeeOrder(session, l.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }

    // A technician writes labour against themselves, at the shop's rate. They
    // cannot assign it to a colleague or reprice it.
    let techId = l.tech_id ?? null;
    let rate = l.rate ?? null;
    if (session.role === "technician") {
      techId = await ownEmployeeId(session);
      rate = null;
    }

    await inShop(session, (tx) => tx`
      SELECT grip.add_labour_line(${l.work_order_id}, ${l.description}, ${l.hours},
        ${l.actual_hours ?? null}, ${rate}, ${l.mode ?? null}, ${techId}, ${l.taxable})`);
    refresh(l.work_order_id);
  });
}

export async function updateLabour(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    line_id: uuid,
    description: z.string().trim().min(1, "Describe the work.").max(300),
    hours: num(999),
    actual_hours: optNum(999),
    rate: num(10_000),
    mode: z.enum(["flat_rate", "straight_time"]),
    tech_id: optUuid,
    taxable: checked,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("workorders.addLabour", async (session) => {
    if (!(await canSeeOrder(session, l.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, async (tx) => {
      let techId = l.tech_id ?? null;
      let rate = l.rate;
      let mode = l.mode;
      let taxable = l.taxable;
      if (session.role === "technician") {
        // Hours and description only. Who it is assigned to, how it is billed,
        // whether it is taxed and the price are not a technician's to change.
        const [cur] = await tx<
          { tech_id: string | null; rate: string; billing_mode: "flat_rate" | "straight_time"; is_taxable: boolean }[]
        >`SELECT tech_id, rate, billing_mode, is_taxable
          FROM grip.work_order_labour_lines WHERE id = ${l.line_id}`;
        techId = cur?.tech_id ?? null;
        rate = Number(cur?.rate ?? 0);
        mode = cur?.billing_mode ?? mode;
        taxable = cur?.is_taxable ?? taxable;
      }
      await tx`SELECT grip.update_labour_line(${l.line_id}, ${l.description}, ${l.hours},
        ${l.actual_hours ?? null}, ${rate}, ${mode}::grip.labour_billing_mode, ${techId}, ${taxable})`;
    });
    refresh(l.work_order_id);
  });
}

export async function removeLabour(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid, line_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("workorders.addLabour", async (session) => {
    if (!(await canSeeOrder(session, l.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`SELECT grip.remove_labour_line(${l.line_id})`);
    refresh(l.work_order_id);
  });
}

export async function addPart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    part_id: uuid,
    qty: z.coerce.number().int("Whole numbers only.").min(1, "Quantity must be at least 1.").max(9999),
    allow_backorder: checked,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  return runAction("workorders.addPart", async (session) => {
    if (!(await canSeeOrder(session, p.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.add_part_to_work_order(${p.work_order_id}, ${p.part_id}, ${p.qty},
                                         ${session.userId}, ${p.allow_backorder})`);
    refresh(p.work_order_id);
  });
}

export async function removePart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid, line_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  return runAction("workorders.addPart", async (session) => {
    if (!(await canSeeOrder(session, p.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.remove_part_from_work_order(${p.line_id}, ${session.userId})`);
    refresh(p.work_order_id);
  });
}

/**
 * Types a shortcut code on a work order: its labour and parts are added in one
 * step. Each half is only added if the person's role may add it — a parts
 * advisor gets the parts of "LOF", a technician gets the labour.
 */
export async function applyShortcut(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    code: z.string().trim().min(1, "Type a shortcut code.").max(12),
    tech_id: optUuid,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction(null, async (session) => {
    const labour = can(session.role, "workorders.addLabour", session.extraRoles);
    const parts = can(session.role, "workorders.addPart", session.extraRoles);
    if (!labour && !parts) {
      throw Object.assign(new Error("You can't add lines to a work order."), { code: "P0001" });
    }
    if (!(await canSeeOrder(session, s.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    const techId = session.role === "technician" ? await ownEmployeeId(session) : s.tech_id ?? null;

    await inShop(session, (tx) => tx`
      SELECT grip.apply_service_shortcut(${s.work_order_id}, ${s.code}, ${techId}, ${labour}, ${parts})`);
    refresh(s.work_order_id);
  });
}

/**
 * The parts half of a shortcut, added when someone fills a labour line from its
 * ABV code. Quietly does nothing for a role that can't add parts, so a
 * technician typing LOF still gets the labour without an error.
 */
export async function addShortcutParts(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    code: z.string().trim().min(1).max(12),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction(null, async (session) => {
    if (!can(session.role, "workorders.addPart", session.extraRoles)) return;
    if (!(await canSeeOrder(session, s.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.apply_service_shortcut(${s.work_order_id}, ${s.code}, ${null}, ${false}, ${true})`);
    refresh(s.work_order_id);
  });
}

// --- document options ----------------------------------------------------------

export async function setTax(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid, tax_rate_id: optUuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const o = parsed.data;

  return runAction("workorders.invoice", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_work_order_tax(${o.work_order_id}, ${o.tax_rate_id ?? null})`);
    refresh(o.work_order_id);
  });
}

export async function setLabourMode(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    mode: z.enum(["flat_rate", "straight_time"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const o = parsed.data;

  return runAction("workorders.invoice", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_work_order_labour_mode(${o.work_order_id}, ${o.mode})`);
    refresh(o.work_order_id);
  });
}

// --- lifecycle -----------------------------------------------------------------

export async function transition(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    to: z.enum(["approved", "in_progress", "completed", "invoiced", "paid", "cancelled"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const t = parsed.data;

  return runAction("workorders.changeStatus", async (session) => {
    if (!canTransition(session.role, t.to as WorkOrderStatus, session.extraRoles)) {
      throw Object.assign(new Error("Your role can't move a work order to that status."), { code: "P0001" });
    }
    if (!(await canSeeOrder(session, t.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.transition_work_order(${t.work_order_id}, ${t.to}::grip.work_order_status)`);
    refresh(t.work_order_id);
  });
}

/**
 * Why this order carries no HST. Required before an exempt order can be
 * invoiced — the database enforces that, this is the form behind it.
 */
export async function setExemption(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    reason: z.preprocess((v) => (v === "" || v == null ? undefined : v),
      z.enum(["status_card", "government", "resale", "export", "internal", "other"]).optional()),
    reference: z.string().trim().max(60).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const e = parsed.data;

  return runAction("workorders.invoice", async (session) => {
    if (!(await canSeeOrder(session, e.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.set_work_order_exemption(${e.work_order_id},
        ${e.reason ?? null}::grip.exempt_reason, ${e.reference ?? null})`);
    refresh(e.work_order_id);
  });
}

// --- notes, details and who the order is for -----------------------------------------

/** What the advisor writes for the customer. Editable in any status. */
export async function saveOrderNotes(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid, notes: z.string().max(5000, "Notes are limited to 5,000 characters.") })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const n = parsed.data;

  return runAction("workorders.addLabour", async (session) => {
    if (!(await canSeeOrder(session, n.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`SELECT grip.set_work_order_notes(${n.work_order_id}, ${n.notes})`);
    refresh(n.work_order_id);
  });
}

/** The customer's concern and the mileage in, corrected on the order itself. */
export async function saveOrderDetails(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    work_order_id: uuid,
    concern: z.string().max(2000, "The concern is limited to 2,000 characters."),
    // Commas are fine: people type 128,400.
    mileage_in: z.preprocess(
      (v) => (v == null ? "" : String(v).replace(/[,\s]|km$/gi, "")),
      z.union([z.literal(""), z.coerce.number().int("Mileage is a whole number.").min(0).max(3_000_000)]),
    ),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const d = parsed.data;

  return runAction("workorders.addLabour", async (session) => {
    if (!(await canSeeOrder(session, d.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.set_work_order_details(${d.work_order_id}, ${d.concern},
        ${d.mileage_in === "" ? null : d.mileage_in})`);
    refresh(d.work_order_id);
  });
}

/** Moves the order to another customer and vehicle, or just another vehicle. */
export async function changeOrderCustomer(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid, customer_id: uuid, vehicle_id: uuid })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Choose a customer and one of their vehicles." };
  const c = parsed.data;

  return runAction("workorders.create", async (session) => {
    if (!(await canSeeOrder(session, c.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`
      SELECT grip.set_work_order_customer(${c.work_order_id}, ${c.customer_id}, ${c.vehicle_id})`);
    refresh(c.work_order_id);
    redirect(`/app/orders/${c.work_order_id}`);
  });
}

/** Tax on or off for one part line. Parts close at completion, like the lines themselves. */
export async function setPartLineTaxable(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid, line_id: uuid, taxable: checked })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  return runAction("workorders.addPart", async (session) => {
    if (!(await canSeeOrder(session, p.work_order_id))) {
      throw Object.assign(new Error("Work order not found."), { code: "P0001" });
    }
    await inShop(session, (tx) => tx`SELECT grip.set_part_line_taxable(${p.line_id}, ${p.taxable})`);
    refresh(p.work_order_id);
  });
}
