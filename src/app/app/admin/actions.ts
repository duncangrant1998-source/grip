"use server";

import { revalidatePath } from "next/cache";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";
import { addDays, isDateString } from "@/lib/dates";
import { emailPlatformAdmin } from "@/lib/notify";
import { splitRoles } from "@/lib/permissions";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const checked = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const money = (label: string) =>
  z.coerce.number({ invalid_type_error: `Enter ${label}.` }).min(0, "Can't be negative.").max(10_000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time.");

function bad(p: { success: false; error: z.ZodError }): ActionState {
  return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
}

const password = z.string().min(8, "A password needs at least 8 characters.").max(200);
const loginRole = z.enum(["service_advisor", "technician", "parts_advisor", "shop_admin"]);
/** Reads the set of checked `roles` checkboxes (the Staff tab's role picker) as a deduplicated array. */
const rolesList = (form: FormData) => {
  const parsed = z.array(loginRole).safeParse(form.getAll("roles"));
  return parsed.success ? Array.from(new Set(parsed.data)) : [];
};

// --- staff --------------------------------------------------------------------------

export async function createStaff(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    full_name: z.string().trim().min(1, "Enter a name.").max(120),
    job_title: optText(80),
    hourly_rate: money("an hourly rate"),
    employment_type: z.enum(["full_time", "part_time", "contractor"]),
    is_technician: checked,
    email: z.string().trim().max(254).optional(),
    role: loginRole.optional(),
    password: z.string().optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  const wantsLogin = !!s.email;
  if (wantsLogin) {
    if (!s.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) return { error: "Enter a valid email for the login." };
    if (!s.role) return { error: "Choose a role for the login." };
    if (!password.safeParse(s.password).success) return { error: "A password needs at least 8 characters." };
  }

  const result = await runAction("staff.manage", async (session) => {
    const id = await inShop(session, async (tx) => {
      let userId: string | null = null;
      if (wantsLogin) {
        const passwordHash = await hash(s.password!);
        const [u] = await tx<{ id: string }[]>`
          SELECT grip.create_user(${s.email!}, ${s.full_name}, ${s.role!}::grip.user_role, ${passwordHash}) AS id`;
        userId = u.id;
      }
      const [e] = await tx<{ id: string }[]>`
        INSERT INTO grip.employees
          (tenant_id, user_id, full_name, job_title, hourly_rate, employment_type, is_technician)
        VALUES
          (${session.tenantId}, ${userId}, ${s.full_name}, ${s.job_title}, ${s.hourly_rate},
           ${s.employment_type}, ${s.is_technician || s.role === "technician"})
        RETURNING id`;
      await tx`SELECT grip.log_audit('staff.created', 'employee', ${e.id}, ${tx.json({ name: s.full_name })})`;
      return e.id;
    });
    revalidatePath("/app/admin/staff");
    redirect(`/app/admin/staff/${id}`);
  });
  return result.error === "That already exists." ? { error: "Someone at this shop already uses that email." } : result;
}

export async function updateStaff(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    id: uuid,
    full_name: z.string().trim().min(1, "Enter a name.").max(120),
    job_title: optText(80),
    phone: optText(40),
    personal_email: optText(254).refine((v) => v == null || /^[^@s]+@[^@s]+.[^@s]+$/.test(v), "Enter a valid email address."),
    address: optText(300),
    hourly_rate: money("an hourly rate"),
    employment_type: z.enum(["full_time", "part_time", "contractor"]),
    is_technician: checked,
    is_active: checked,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  return runAction("staff.manage", async (session) => {
    await inShop(session, async (tx) => {
      if (!s.is_active) {
        const [open] = await tx`SELECT 1 FROM grip.time_entries WHERE employee_id = ${s.id} AND clock_out IS NULL`;
        if (open) {
          throw Object.assign(new Error("They are on the clock right now. Clock them out first."), { code: "P0001" });
        }
      }
      await tx`
        UPDATE grip.employees SET full_name = ${s.full_name}, job_title = ${s.job_title},
          phone = ${s.phone}, personal_email = ${s.personal_email}, address = ${s.address},
          hourly_rate = ${s.hourly_rate}, employment_type = ${s.employment_type},
          is_technician = ${s.is_technician}, is_active = ${s.is_active}
        WHERE id = ${s.id}`;
      await tx`SELECT grip.log_audit('staff.updated', 'employee', ${s.id}, ${tx.json({ name: s.full_name })})`;
    });
    revalidatePath("/app/admin/staff");
    revalidatePath(`/app/admin/staff/${s.id}`);
  });
}

/** Give an existing staff record a login, either a new one or one already in the shop. */
export async function addLogin(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    employee_id: uuid,
    mode: z.enum(["new", "link"]),
    email: z.string().trim().max(254).optional(),
    role: loginRole.optional(),
    password: z.string().optional(),
    existing_user_id: optUuid,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const a = parsed.data;

  if (a.mode === "new") {
    if (!a.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) return { error: "Enter a valid email." };
    if (!a.role) return { error: "Choose a role." };
    if (!password.safeParse(a.password).success) return { error: "A password needs at least 8 characters." };
  } else if (!a.existing_user_id) {
    return { error: "Choose which login to link." };
  }

  const result = await runAction("staff.manage", async (session) => {
    await inShop(session, async (tx) => {
      const [emp] = await tx<{ full_name: string }[]>`SELECT full_name FROM grip.employees WHERE id = ${a.employee_id}`;
      if (!emp) throw Object.assign(new Error("Staff member not found."), { code: "P0001" });

      let userId = a.existing_user_id ?? null;
      if (a.mode === "new") {
        const passwordHash = await hash(a.password!);
        const [u] = await tx<{ id: string }[]>`
          SELECT grip.create_user(${a.email!}, ${emp.full_name}, ${a.role!}::grip.user_role, ${passwordHash}) AS id`;
        userId = u.id;
      }
      await tx`UPDATE grip.employees SET user_id = ${userId} WHERE id = ${a.employee_id}`;
      await tx`
        UPDATE grip.employees SET is_technician = true
        WHERE id = ${a.employee_id}
          AND EXISTS (SELECT 1 FROM grip.users WHERE id = ${userId} AND role = 'technician')`;
    });
    revalidatePath(`/app/admin/staff/${a.employee_id}`);
    revalidatePath("/app/admin/staff");
  });
  return result.error === "That already exists." ? { error: "That login is already linked, or the email is taken." } : result;
}

/**
 * Sets which roles a login has (one or more, from the Staff tab's role
 * picker) and whether it can sign in at all. Used both by the compact
 * dropdown on the staff list and the fuller form on a staff member's own
 * page — each carries the field it isn't changing as a hidden input, so
 * ticking roles in the list dropdown can't accidentally flip "can sign in".
 */
export async function updateAccess(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ employee_id: uuid, user_id: uuid, is_active: checked })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const a = parsed.data;
  const roles = rolesList(form);
  if (roles.length === 0) return { error: "Choose at least one role." };
  const { role, extraRoles } = splitRoles(roles);

  return runAction("staff.manage", async (session) => {
    const [notification] = await inShop(session, (tx) => tx<{ notify_title: string | null; notify_body: string | null }[]>`
      SELECT * FROM grip.update_user_access(
        ${a.user_id}, ${role}::grip.user_role, ${a.is_active}, ${extraRoles}::grip.user_role[])`);
    revalidatePath(`/app/admin/staff/${a.employee_id}`);
    revalidatePath("/app/admin/staff");
    if (notification?.notify_title && notification.notify_body) {
      await emailPlatformAdmin({ title: notification.notify_title, body: notification.notify_body });
    }
  });
}

export async function resetPassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ employee_id: uuid, user_id: uuid, password })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const r = parsed.data;

  return runAction("staff.manage", async (session) => {
    const passwordHash = await hash(r.password);
    await inShop(session, (tx) => tx`SELECT grip.set_user_password(${r.user_id}, ${passwordHash})`);
    revalidatePath(`/app/admin/staff/${r.employee_id}`);
  });
}

// --- shifts -------------------------------------------------------------------------

/** One form schedules several days: tick the weekdays, set the hours. */
export async function addShifts(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    employee_id: uuid,
    week_start: z.string().refine(isDateString, "Unknown week."),
    start: time,
    end: time,
    note: optText(120),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;

  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => form.get(`day_${i}`) === "on");
  if (days.length === 0) return { error: "Tick at least one day." };
  if (s.end <= s.start) return { error: "A shift must end after it starts." };

  return runAction("staff.manage", async (session) => {
    await inShop(session, async (tx) => {
      // All or nothing: one clash cancels the whole batch rather than half-scheduling a week.
      for (const i of days) {
        const d = addDays(s.week_start, i);
        await tx`
          SELECT grip.add_shift(${s.employee_id}, ${`${d} ${s.start}`}::text::timestamp,
            ${`${d} ${s.end}`}::text::timestamp, ${s.note})`;
      }
    });
    revalidatePath("/app/admin/shifts");
  });
}

export async function deleteShift(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("staff.manage", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.delete_shift(${parsed.data.id})`);
    revalidatePath("/app/admin/shifts");
  });
}

/**
 * Removes someone from staff: the login is closed for good and its email freed,
 * the person stays on file with their history. The confirmation lives in the UI
 * (ConfirmButton); the rules — not yourself, not the last administrator — live
 * in the database where they cannot be skipped.
 */
export async function removeStaff(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid, note: optText(500) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const r = parsed.data;

  return runAction("staff.manage", async (session) => {
    const result = await inShop(session, async (tx) => {
      const [emp] = await tx<{ full_name: string }[]>`SELECT full_name FROM grip.employees WHERE id = ${r.id}`;
      const [out] = await tx<{ r: { shifts_removed: number; appointments_unassigned: number } }[]>`
        SELECT grip.remove_employee(${r.id}, ${r.note}) AS r`;
      return { name: emp?.full_name ?? "Staff member", ...out.r };
    });
    revalidatePath("/app/admin/staff");
    revalidatePath("/app/admin/shifts");
    redirect(`/app/admin/staff?removed=${encodeURIComponent(result.name)}&shifts=${result.shifts_removed}&bookings=${result.appointments_unassigned}`);
  });
}

// --- timesheets ---------------------------------------------------------------------

export async function saveTimeEntry(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    id: optUuid,
    employee_id: uuid,
    date: z.string().refine(isDateString, "Choose a valid date."),
    in_time: time,
    out_time: z.preprocess((v) => (v === "" || v == null ? undefined : v), time.optional()),
    next_day: checked,
    note: optText(200),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const t = parsed.data;

  return runAction("staff.manage", async (session) => {
    const outDate = t.next_day ? addDays(t.date, 1) : t.date;
    await inShop(session, (tx) => tx`
      SELECT grip.save_time_entry(
        ${t.id ?? null}, ${t.employee_id}, ${`${t.date} ${t.in_time}`}::text::timestamp,
        ${t.out_time ? `${outDate} ${t.out_time}` : null}::text::timestamp, ${t.note})`);
    revalidatePath("/app/admin/timesheets");
    revalidatePath("/app/time");
  });
}

export async function deleteTimeEntry(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);

  return runAction("staff.manage", async (session) => {
    await inShop(session, (tx) => tx`SELECT grip.delete_time_entry(${parsed.data.id})`);
    revalidatePath("/app/admin/timesheets");
  });
}

/**
 * One click on a day in an employee's row: a shift for that person that day, at
 * the default hours shown above the grid. The same clash rules as any other
 * shift apply, so a day they already work refuses with the reason.
 */
export async function addShiftOnDay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z.object({
    employee_id: uuid,
    date: z.string().refine(isDateString, "Unknown day."),
    start: time,
    end: time,
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return bad(parsed);
  const s = parsed.data;
  if (s.end <= s.start) return { error: "A shift must end after it starts." };

  return runAction("staff.manage", async (session) => {
    await inShop(session, (tx) => tx`
      SELECT grip.add_shift(${s.employee_id}, ${`${s.date} ${s.start}`}::text::timestamp,
        ${`${s.date} ${s.end}`}::text::timestamp, NULL)`);
    revalidatePath("/app/admin/shifts");
    revalidatePath("/app/time");
  });
}
