"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, type ActionState } from "@/lib/action";
import { isDateString } from "@/lib/dates";

const uuid = z.string().uuid();
const optUuid = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v), uuid.optional());

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

function refresh() {
  revalidatePath("/app/time");
  revalidatePath("/app/admin/timeoff");
  revalidatePath("/app");
}

/**
 * Two clocks. The shift is clocked in and out once a day, whoever you are; time
 * on a job is logged inside it, one job at a time.
 */
export async function clockIn(_prev: ActionState): Promise<ActionState> {
  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.clock_in()`);
    refresh();
  });
}

export async function clockOut(_prev: ActionState): Promise<ActionState> {
  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.clock_out()`);
    refresh();
  });
}

/** Start time on a job (this ends the one before it). */
export async function startJob(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ work_order_id: uuid.or(z.literal("").transform(() => undefined)) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success || !parsed.data.work_order_id) return { error: "Choose which job you're starting." };
  const id = parsed.data.work_order_id;

  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.start_job_time(${id})`);
    refresh();
    revalidatePath(`/app/orders/${id}`);
  });
}

/** Stop the job but stay on shift. */
export async function stopJob(_prev: ActionState): Promise<ActionState> {
  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.stop_job_time()`);
    refresh();
  });
}

// --- time off ------------------------------------------------------------------------

export async function requestTimeOff(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    from: z.string().refine(isDateString, "Choose the first day."),
    to: z.string().refine(isDateString, "Choose the last day."),
    note: z.string().trim().max(1000, "Keep the note under 1,000 characters.").optional(),
    recipient: optUuid,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const r = parsed.data;

  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.request_time_off(${r.from}::text::date, ${r.to}::text::date,
                                   ${r.note ?? null}, ${r.recipient ?? null})`);
    refresh();
  }).then((res) =>
    // The overlap constraint's name means nothing to a person.
    res.error?.includes("those days") || res.error === "That already exists."
      ? { error: "You already have a request that covers some of those days." }
      : res,
  );
}

export async function cancelTimeOff(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.cancel_time_off(${parsed.data.id})`);
    refresh();
  });
}

export async function decideTimeOff(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    id: uuid,
    decision: z.enum(["approve", "decline"]),
    reply: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const d = parsed.data;

  // Anyone may try: the database decides whether it was sent to them or they administer the shop.
  return runAction("timeclock.own", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.decide_time_off(${d.id}, ${d.decision === "approve"}, ${d.reply ?? null})`);
    refresh();
  });
}
