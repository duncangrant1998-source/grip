"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const code = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,11}$/, "Codes are 1–12 letters, numbers or dashes, e.g. LOF.");
const name = z.string().trim().min(1, "Give the service a name.").max(120);
const num = (max: number) =>
  z.coerce.number({ invalid_type_error: "Enter a number." }).finite().min(0, "Can't be negative.").max(max);
const optNum = (max: number) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), num(max).optional());
const checked = z.preprocess((v) => v === "on" || v === "true", z.boolean());

function bad(parsed: { success: false; error: z.ZodError }): ActionState {
  return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
}

function refresh(id?: string) {
  revalidatePath("/app/shortcuts");
  if (id) revalidatePath(`/app/shortcuts/${id}`);
}

export async function createShortcut(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ code, name }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("shortcuts.manage", async (session) => {
    const [row] = await inShop(session, (tx) => tx<{ id: string }[]>`
      INSERT INTO grip.service_shortcuts (tenant_id, code, name)
      VALUES (${session.tenantId}, ${s.code}, ${s.name}) RETURNING id`);
    refresh();
    redirect(`/app/shortcuts/${row.id}`);
  });
}

export async function updateShortcut(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, code, name, active: checked }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("shortcuts.manage", async (session) => {
    await inShop(session, (tx) => tx`
      UPDATE grip.service_shortcuts
      SET code = ${s.code}, name = ${s.name}, is_active = ${s.active}
      WHERE id = ${s.id}`);
    refresh(s.id);
  });
}

export async function deleteShortcut(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("shortcuts.manage", async (session) => {
    await inShop(session, (tx) => tx`DELETE FROM grip.service_shortcuts WHERE id = ${parsed.data.id}`);
    refresh();
    redirect("/app/shortcuts");
  });
}

export async function addShortcutLabour(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    shortcut_id: uuid,
    description: z.string().trim().min(1, "Describe the work.").max(300),
    hours: num(999),
    rate: optNum(10_000),
    mode: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["flat_rate", "straight_time"]).optional()),
    taxable: checked,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const l = parsed.data;

  return runAction("shortcuts.manage", async (session) => {
    await inShop(session, (tx) => tx`
      INSERT INTO grip.service_shortcut_labour
        (tenant_id, shortcut_id, description, hours, rate, billing_mode, is_taxable, sort_order)
      VALUES (${session.tenantId}, ${l.shortcut_id}, ${l.description}, ${l.hours},
              ${l.rate ?? null}, ${l.mode ?? null}::grip.labour_billing_mode, ${l.taxable},
              (SELECT coalesce(max(sort_order), 0) + 1 FROM grip.service_shortcut_labour
               WHERE shortcut_id = ${l.shortcut_id}))`);
    refresh(l.shortcut_id);
  });
}

export async function removeShortcutLabour(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ shortcut_id: uuid, line_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("shortcuts.manage", async (session) => {
    await inShop(session, (tx) => tx`
      DELETE FROM grip.service_shortcut_labour WHERE id = ${parsed.data.line_id}`);
    refresh(parsed.data.shortcut_id);
  });
}

export async function addShortcutPart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    shortcut_id: uuid,
    part_id: uuid,
    qty: z.coerce.number().int("Whole numbers only.").min(1, "Quantity must be at least 1.").max(9999),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const p = parsed.data;

  return runAction("shortcuts.manage", async (session) => {
    // Adding the same part again raises the quantity instead of duplicating the line.
    await inShop(session, (tx) => tx`
      INSERT INTO grip.service_shortcut_parts (tenant_id, shortcut_id, part_id, qty, sort_order)
      VALUES (${session.tenantId}, ${p.shortcut_id}, ${p.part_id}, ${p.qty},
              (SELECT coalesce(max(sort_order), 0) + 1 FROM grip.service_shortcut_parts
               WHERE shortcut_id = ${p.shortcut_id}))
      ON CONFLICT (shortcut_id, part_id) DO UPDATE SET qty = grip.service_shortcut_parts.qty + EXCLUDED.qty`);
    refresh(p.shortcut_id);
  });
}

export async function removeShortcutPart(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ shortcut_id: uuid, line_id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("shortcuts.manage", async (session) => {
    await inShop(session, (tx) => tx`
      DELETE FROM grip.service_shortcut_parts WHERE id = ${parsed.data.line_id}`);
    refresh(parsed.data.shortcut_id);
  });
}
