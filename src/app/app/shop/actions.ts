"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, type ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const money = (label: string) =>
  z.coerce.number({ invalid_type_error: `Enter ${label}.` }).min(0, "Can't be negative.").max(10_000);

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

/** Shop settings reach the schedule, the dashboard and every open document. */
function refresh() {
  revalidatePath("/app/shop");
  revalidatePath("/app/schedule");
  revalidatePath("/app");
}

// --- details ------------------------------------------------------------------------

export async function saveShopDetails(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    legal_name: optText(120), address_line1: optText(120), city: optText(80),
    region: optText(40), postal_code: optText(20), country: z.string().trim().max(2).default("CA"),
    phone: optText(40),
    hst_number: z.string().trim().max(30).optional().transform((v) => v?.replace(/[\s-]/g, "").toUpperCase() || null)
      .refine((v) => v === null || /^\d{9}RT\d{4}$/.test(v), "An HST number looks like 123456789RT0001."),
    email: z.string().trim().max(254).optional().transform((v) => v || null)
      .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "That email doesn't look right."),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("settings.manage", async (session) => {
    await inShop(session, (tx) => tx`
      INSERT INTO grip.tenant_settings
        (tenant_id, legal_name, address_line1, city, region, postal_code, country, phone, email, hst_number)
      VALUES (${session.tenantId}, ${s.legal_name}, ${s.address_line1}, ${s.city}, ${s.region},
              ${s.postal_code}, ${s.country || "CA"}, ${s.phone}, ${s.email}, ${s.hst_number})
      ON CONFLICT (tenant_id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name, address_line1 = EXCLUDED.address_line1, city = EXCLUDED.city,
        region = EXCLUDED.region, postal_code = EXCLUDED.postal_code, country = EXCLUDED.country,
        phone = EXCLUDED.phone, email = EXCLUDED.email, hst_number = EXCLUDED.hst_number,
        updated_at = now()`);
    refresh();
    revalidatePath("/app/orders");
  });
}

export async function saveDocuments(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    logo_url: z.string().trim().max(500).optional().transform((v) => v || null)
      .refine((v) => v === null || /^https:\/\/\S+$/.test(v), "The logo must be an https:// link."),
    invoice_footer: optText(500),
    invoice_template: z.enum(["classic", "modern", "minimal"]).default("classic"),
    invoice_logo_position: z.enum(["left", "center", "right"]).default("left"),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("settings.manage", async (session) => {
    await inShop(session, (tx) => tx`
      INSERT INTO grip.tenant_settings
        (tenant_id, logo_url, invoice_footer, invoice_template, invoice_logo_position)
      VALUES (${session.tenantId}, ${s.logo_url}, ${s.invoice_footer},
              ${s.invoice_template}::grip.invoice_template,
              ${s.invoice_logo_position}::grip.invoice_logo_position)
      ON CONFLICT (tenant_id) DO UPDATE SET
        logo_url = EXCLUDED.logo_url, invoice_footer = EXCLUDED.invoice_footer,
        invoice_template = EXCLUDED.invoice_template,
        invoice_logo_position = EXCLUDED.invoice_logo_position, updated_at = now()`);
    refresh();
    revalidatePath("/app/orders");
  });
}

// --- hours --------------------------------------------------------------------------

export async function saveCalendar(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    timezone: z.string().trim().min(1, "Choose a timezone.").max(64),
    open_hour: z.coerce.number().int().min(0).max(23),
    close_hour: z.coerce.number().int().min(1).max(24),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;
  if (s.close_hour <= s.open_hour) return { error: "The shop must close after it opens." };

  return runAction("settings.manage", async (session) => {
    await inShop(session, async (tx) => {
      const [ok] = await tx`SELECT 1 FROM pg_timezone_names WHERE name = ${s.timezone}`;
      if (!ok) throw Object.assign(new Error("That isn't a timezone Grip recognises."), { code: "P0001" });
      await tx`
        INSERT INTO grip.tenant_settings (tenant_id, timezone, open_hour, close_hour)
        VALUES (${session.tenantId}, ${s.timezone}, ${s.open_hour}, ${s.close_hour})
        ON CONFLICT (tenant_id) DO UPDATE SET
          timezone = EXCLUDED.timezone, open_hour = EXCLUDED.open_hour,
          close_hour = EXCLUDED.close_hour, updated_at = now()`;
    });
    refresh();
  });
}

// --- pricing ------------------------------------------------------------------------

export async function saveLabour(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    default_labour_rate: money("a labour rate"),
    labour_billing_mode: z.enum(["flat_rate", "straight_time"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("settings.manage", async (session) => {
    await inShop(session, (tx) => tx`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode)
      VALUES (${session.tenantId}, ${s.default_labour_rate}, ${s.labour_billing_mode}::grip.labour_billing_mode)
      ON CONFLICT (tenant_id) DO UPDATE SET
        default_labour_rate = EXCLUDED.default_labour_rate,
        labour_billing_mode = EXCLUDED.labour_billing_mode, updated_at = now()`);
    refresh();
  });
}

/**
 * Grip is sold to Ontario shops, so there is one rate to set: HST. The rate is
 * editable because Ontario's has moved before and will again; the exempt option
 * is fixed at nothing and needs no settings of its own.
 *
 * The CRA business number is the RT (GST/HST) account: nine digits, RT, four
 * digits. It is stored without spaces and printed on invoices, which is a legal
 * requirement once a shop is registered.
 */
export async function saveTax(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    hst_pct: z.coerce.number({ invalid_type_error: "Enter the HST rate as a percentage." })
      .finite().min(0, "The HST rate can't be negative.").max(30, "That rate looks wrong — Ontario's is 13%."),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const t = parsed.data;

  return runAction("settings.manage", async (session) => {
    await inShop(session, async (tx) => {
      // Basis points, so 13% is 1300 — rounded, never floating.
      await tx`SELECT grip.set_hst_rate(${Math.round(t.hst_pct * 100)})`;
    });
    refresh();
    revalidatePath("/app/orders");
  });
}

// --- bays ---------------------------------------------------------------------------

export async function addBay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ name: z.string().trim().min(1, "Give the bay a name.").max(40) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  const result = await runAction("settings.manage", async (session) => {
    await inShop(session, (tx) => tx`
      INSERT INTO grip.bays (tenant_id, name, sort_order)
      VALUES (${session.tenantId}, ${parsed.data.name},
              coalesce((SELECT max(sort_order) + 1 FROM grip.bays), 0))`);
    refresh();
  });
  return result.error === "That already exists." ? { error: "You already have a bay with that name." } : result;
}

export async function updateBay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    id: uuid,
    name: z.string().trim().min(1, "Give the bay a name.").max(40),
    is_active: z.preprocess((v) => v === "on", z.boolean()),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const b = parsed.data;

  const result = await runAction("settings.manage", async (session) => {
    await inShop(session, async (tx) => {
      if (!b.is_active) {
        // Retiring a bay with upcoming work would strand those appointments.
        const [open] = await tx<{ n: string }[]>`
          SELECT count(*) AS n FROM grip.appointments
          WHERE bay_id = ${b.id} AND starts_at >= now()
            AND status IN ('scheduled', 'confirmed', 'arrived', 'in_progress')`;
        if (Number(open.n) > 0) {
          throw Object.assign(
            new Error(`Move or cancel the ${open.n} upcoming appointment${open.n === "1" ? "" : "s"} in this bay first.`),
            { code: "P0001" });
        }
      }
      await tx`UPDATE grip.bays SET name = ${b.name}, is_active = ${b.is_active} WHERE id = ${b.id}`;
    });
    refresh();
  });
  return result.error === "That already exists." ? { error: "You already have a bay with that name." } : result;
}

/** Only ever removes a bay nothing points at; the database decides, not the form. */
export async function deleteBay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("settings.manage", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.delete_bay(${parsed.data.id})`);
    refresh();
  });
}
