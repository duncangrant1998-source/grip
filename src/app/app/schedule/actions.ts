"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";
import { isDateString } from "@/lib/dates";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

function refresh(id?: string) {
  revalidatePath("/app/schedule");
  if (id) revalidatePath(`/app/schedule/${id}`);
  revalidatePath("/app");
}

const slot = {
  date: z.string().refine(isDateString, "Choose a valid date."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time."),
  minutes: z.coerce.number({ invalid_type_error: "Choose how long it will take." })
    .int().min(5, "That's too short.").max(1440, "That's too long."),
  bay_id: optUuid,
  tech_id: optUuid,
  concern: z.string().trim().max(2000).optional(),
};

/**
 * The shop's wall-clock time goes to the database as TEXT and is cast there.
 * Passing it as a typed timestamp makes the driver reinterpret it through the
 * server's own timezone, which would move every booking by the server's offset.
 */
export async function createAppointment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ customer_id: uuid, vehicle_id: uuid, ...slot })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const a = parsed.data;

  // Booking starts the work order too, so the person lands on it: the concern,
  // the quote and the parts desk's view all begin here rather than at a later step.
  return runAction("appointments.edit", async (session) => {
    const [row] = await inShop(session, (tx) => tx<{ id: string }[]>`
      SELECT grip.create_appointment_with_order(
        ${a.customer_id}, ${a.vehicle_id}, ${`${a.date} ${a.time}`}::text::timestamp,
        ${a.minutes}, ${a.bay_id ?? null}, ${a.tech_id ?? null}, ${a.concern ?? null}) AS id`);
    refresh();
    revalidatePath("/app/orders");
    redirect(`/app/orders/${row.id}`);
  });
}

export async function updateAppointment(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, ...slot }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const a = parsed.data;

  return runAction("appointments.edit", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.update_appointment(
        ${a.id}, ${`${a.date} ${a.time}`}::text::timestamp, ${a.minutes},
        ${a.bay_id ?? null}, ${a.tech_id ?? null}, ${a.concern ?? null})`);
    refresh(a.id);
  });
}

export async function setAppointmentStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    id: uuid,
    to: z.enum(["confirmed", "arrived", "in_progress", "completed", "cancelled", "no_show"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("appointments.edit", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.set_appointment_status(${parsed.data.id}, ${parsed.data.to}::grip.appointment_status)`);
    refresh(parsed.data.id);
  });
}

export async function convertToWorkOrder(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("workorders.create", async (session) => {
    const [row] = await inShop(session, (tx) => tx<{ wo: string }[]>`
      SELECT grip.convert_appointment_to_work_order(${parsed.data.id}) AS wo`);
    refresh(parsed.data.id);
    revalidatePath("/app/orders");
    redirect(`/app/orders/${row.wo}`);
  });
}
