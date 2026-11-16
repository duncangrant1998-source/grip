import "server-only";
import { inShop } from "./auth";
import type { Session } from "./session";
import type { Role } from "./permissions";

// Times are converted to the shop's wall clock in SQL and returned as plain
// strings / minute counts (see schedule-queries.ts for why).

// --- staff -------------------------------------------------------------------------

export type StaffRow = {
  id: string; full_name: string; job_title: string | null; hourly_rate: string;
  employment_type: string; is_active: boolean; is_technician: boolean;
  user_id: string | null; email: string | null; role: Role | null; login_active: boolean | null;
  on_clock: boolean;
};

/** Current staff. People who have been removed are kept on file but are not staff any more. */
export function listStaff(session: Session) {
  return inShop(session, (tx) => tx<StaffRow[]>`
    SELECT e.id, e.full_name, e.job_title, e.hourly_rate, e.employment_type, e.is_active,
           e.is_technician, e.user_id, u.email, u.role, u.is_active AS login_active,
           EXISTS (SELECT 1 FROM grip.time_entries t
                   WHERE t.employee_id = e.id AND t.clock_out IS NULL) AS on_clock
    FROM grip.employees e LEFT JOIN grip.users u ON u.id = e.user_id
    WHERE e.removed_at IS NULL
    ORDER BY e.is_active DESC, e.full_name`);
}

export type RemovedStaffRow = {
  id: string; full_name: string; job_title: string | null; role: Role | null;
  removed_at: Date; removed_by_name: string | null; removal_note: string | null;
  hours: string;
};

/** Everyone who has been removed, most recent first, with the hours they worked. */
export function listRemovedStaff(session: Session) {
  return inShop(session, (tx) => tx<RemovedStaffRow[]>`
    SELECT e.id, e.full_name, e.job_title, u.role, e.removed_at, rb.full_name AS removed_by_name,
           e.removal_note,
           coalesce((SELECT sum(extract(epoch FROM t.clock_out - t.clock_in) / 3600.0)
                     FROM grip.time_entries t
                     WHERE t.employee_id = e.id AND t.clock_out IS NOT NULL), 0)::numeric(10,1) AS hours
    FROM grip.employees e
    LEFT JOIN grip.users u ON u.id = e.user_id
    LEFT JOIN grip.users rb ON rb.id = e.removed_by
    WHERE e.removed_at IS NOT NULL
    ORDER BY e.removed_at DESC`);
}

export async function getStaff(session: Session, id: string) {
  const [row] = await inShop(session, (tx) => tx<
    (StaffRow & {
      billable_rate: string | null; last_login_at: Date | null; created_at: Date;
      removed_at: Date | null; removed_by_name: string | null; removal_note: string | null;
      phone: string | null; personal_email: string | null; address: string | null;
    })[]
  >`
    SELECT e.id, e.full_name, e.job_title, e.hourly_rate, e.billable_rate, e.employment_type,
           e.is_active, e.is_technician, e.user_id, u.email, u.role,
           u.is_active AS login_active, u.last_login_at, false AS on_clock,
           e.created_at, e.removed_at, rb.full_name AS removed_by_name, e.removal_note,
           e.phone, e.personal_email, e.address
    FROM grip.employees e
    LEFT JOIN grip.users u ON u.id = e.user_id
    LEFT JOIN grip.users rb ON rb.id = e.removed_by
    WHERE e.id = ${id}`);
  return row ?? null;
}

export type StaffRecord = {
  total_hours: string; days: number; first_day: string | null; last_day: string | null;
  jobs: number; entries: { id: string; local_date: string; in_time: string; out_time: string | null;
                           minutes: number | null; work_order_number: number | null }[];
};

/** What someone did while they were here: for a removed person this is the whole record. */
export async function staffRecord(session: Session, employeeId: string): Promise<StaffRecord> {
  return inShop(session, async (tx) => {
    const [sum] = await tx<
      { total_hours: string; days: number; first_day: string | null; last_day: string | null }[]
    >`
      WITH tz AS (SELECT grip.shop_timezone() AS z)
      SELECT coalesce(sum(extract(epoch FROM t.clock_out - t.clock_in) / 3600.0), 0)::numeric(10,1) AS total_hours,
             count(DISTINCT (t.clock_in AT TIME ZONE tz.z)::date)::int AS days,
             to_char(min(t.clock_in AT TIME ZONE tz.z), 'YYYY-MM-DD') AS first_day,
             to_char(max(t.clock_in AT TIME ZONE tz.z), 'YYYY-MM-DD') AS last_day
      FROM grip.time_entries t CROSS JOIN tz
      WHERE t.employee_id = ${employeeId} AND t.clock_out IS NOT NULL`;
    const [jobs] = await tx<{ n: number }[]>`
      SELECT count(DISTINCT work_order_id)::int AS n FROM (
        SELECT work_order_id FROM grip.time_entries
        WHERE employee_id = ${employeeId} AND work_order_id IS NOT NULL
        UNION
        SELECT work_order_id FROM grip.job_time_entries WHERE employee_id = ${employeeId}
      ) x`;
    const entries = await tx<StaffRecord["entries"]>`
      WITH tz AS (SELECT grip.shop_timezone() AS z)
      SELECT t.id, to_char(t.clock_in AT TIME ZONE tz.z, 'YYYY-MM-DD') AS local_date,
             to_char(t.clock_in AT TIME ZONE tz.z, 'HH24:MI') AS in_time,
             to_char(t.clock_out AT TIME ZONE tz.z, 'HH24:MI') AS out_time,
             (extract(epoch FROM t.clock_out - t.clock_in) / 60)::int AS minutes,
             w.number AS work_order_number
      FROM grip.time_entries t CROSS JOIN tz
      LEFT JOIN grip.work_orders w ON w.id = t.work_order_id
      WHERE t.employee_id = ${employeeId}
      ORDER BY t.clock_in DESC LIMIT 60`;
    return { ...sum, jobs: jobs.n, entries };
  });
}

/** Logins that are not yet attached to a staff record (so they can be linked). */
export function unlinkedLogins(session: Session) {
  return inShop(session, (tx) => tx<{ id: string; full_name: string; email: string; role: Role }[]>`
    SELECT u.id, u.full_name, u.email, u.role FROM grip.users u
    WHERE u.is_active AND NOT EXISTS (SELECT 1 FROM grip.employees e WHERE e.user_id = u.id)
    ORDER BY u.full_name`);
}

// --- shifts ------------------------------------------------------------------------

export type ShiftRow = {
  id: string; employee_id: string; full_name: string; local_date: string;
  start_min: number; end_min: number; note: string | null;
};

export function listShifts(session: Session, from: string, to: string, employeeId?: string) {
  return inShop(session, (tx) => tx<ShiftRow[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT s.id, s.employee_id, e.full_name,
           to_char(s.starts_at AT TIME ZONE tz.z, 'YYYY-MM-DD') AS local_date,
           (extract(hour FROM s.starts_at AT TIME ZONE tz.z) * 60
            + extract(minute FROM s.starts_at AT TIME ZONE tz.z))::int AS start_min,
           (extract(hour FROM s.ends_at AT TIME ZONE tz.z) * 60
            + extract(minute FROM s.ends_at AT TIME ZONE tz.z))::int AS end_min,
           s.note
    FROM grip.shifts s CROSS JOIN tz
    JOIN grip.employees e ON e.id = s.employee_id
    WHERE s.starts_at >= (${from}::text::date)::timestamp AT TIME ZONE tz.z
      AND s.starts_at <  (${to}::text::date)::timestamp   AT TIME ZONE tz.z
      ${employeeId ? tx`AND s.employee_id = ${employeeId}` : tx``}
    ORDER BY e.full_name, s.starts_at`);
}

// --- the time clock ----------------------------------------------------------------

export type EntryRow = {
  id: string; employee_id: string; full_name: string; local_date: string;
  in_time: string; out_time: string | null; minutes: number | null;
  open_minutes: number | null; work_order_id: string | null; work_order_number: number | null;
  note: string | null; out_date: string | null;
};

export function listEntries(
  session: Session, from: string, to: string, employeeId?: string,
) {
  return inShop(session, (tx) => tx<EntryRow[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT t.id, t.employee_id, e.full_name,
           to_char(t.clock_in AT TIME ZONE tz.z, 'YYYY-MM-DD') AS local_date,
           to_char(t.clock_in AT TIME ZONE tz.z, 'HH24:MI') AS in_time,
           to_char(t.clock_out AT TIME ZONE tz.z, 'HH24:MI') AS out_time,
           to_char(t.clock_out AT TIME ZONE tz.z, 'YYYY-MM-DD') AS out_date,
           (extract(epoch FROM t.clock_out - t.clock_in) / 60)::int AS minutes,
           CASE WHEN t.clock_out IS NULL
                THEN (extract(epoch FROM now() - t.clock_in) / 60)::int END AS open_minutes,
           t.work_order_id, w.number AS work_order_number, t.note
    FROM grip.time_entries t CROSS JOIN tz
    JOIN grip.employees e ON e.id = t.employee_id
    LEFT JOIN grip.work_orders w ON w.id = t.work_order_id
    WHERE t.clock_in >= (${from}::text::date)::timestamp AT TIME ZONE tz.z
      AND t.clock_in <  (${to}::text::date)::timestamp   AT TIME ZONE tz.z
      ${employeeId ? tx`AND t.employee_id = ${employeeId}` : tx``}
    ORDER BY t.clock_in DESC LIMIT 500`);
}

export type FlatLine = {
  id: string; employee_id: string; full_name: string; done_date: string;
  work_order_id: string; work_order_number: number | string; description: string;
  billed_hours: string; actual_hours: string;
};

/**
 * The flat-rate work a person finished in a period: labour lines billed as flat
 * rate and assigned to them, on orders that were completed in the range. Billed
 * is what the job is worth; actual is the time it took them.
 */
export function listFlatRateLines(session: Session, from: string, to: string, employeeId?: string) {
  return inShop(session, (tx) => tx<FlatLine[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT l.id, l.tech_id AS employee_id, e.full_name,
           to_char(w.completed_at AT TIME ZONE tz.z, 'YYYY-MM-DD') AS done_date,
           w.id AS work_order_id, w.number AS work_order_number, l.description,
           l.billed_hours, l.actual_hours
    FROM grip.work_order_labour_lines l CROSS JOIN tz
    JOIN grip.work_orders w ON w.id = l.work_order_id
    JOIN grip.employees e ON e.id = l.tech_id
    WHERE l.billing_mode = 'flat_rate'
      AND w.status <> 'cancelled' AND w.completed_at IS NOT NULL
      AND w.completed_at >= (${from}::text::date)::timestamp AT TIME ZONE tz.z
      AND w.completed_at <  (${to}::text::date)::timestamp   AT TIME ZONE tz.z
      ${employeeId ? tx`AND l.tech_id = ${employeeId}` : tx``}
    ORDER BY w.completed_at DESC, l.created_at LIMIT 1000`);
}

/** Who has put time into one work order, and how long (open entries count up to now). */
export function orderJobTime(session: Session, orderId: string) {
  return inShop(session, (tx) => tx<{ employee_id: string; full_name: string; minutes: number; on_now: boolean }[]>`
    SELECT j.employee_id, e.full_name,
           sum(extract(epoch FROM coalesce(j.clock_out, now()) - j.clock_in) / 60)::int AS minutes,
           bool_or(j.clock_out IS NULL) AS on_now
    FROM grip.job_time_entries j JOIN grip.employees e ON e.id = j.employee_id
    WHERE j.work_order_id = ${orderId}
    GROUP BY j.employee_id, e.full_name ORDER BY minutes DESC`);
}

export type JobTimeRow = {
  id: string; employee_id: string; full_name: string; local_date: string;
  in_time: string; out_time: string | null; minutes: number;
  work_order_id: string; work_order_number: number | string; customer: string; vehicle: string;
};

/** Time logged on jobs in a range (open entries count up to now), newest first. */
export function listJobTime(session: Session, from: string, to: string, employeeId?: string) {
  return inShop(session, (tx) => tx<JobTimeRow[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT j.id, j.employee_id, e.full_name,
           to_char(j.clock_in AT TIME ZONE tz.z, 'YYYY-MM-DD') AS local_date,
           to_char(j.clock_in AT TIME ZONE tz.z, 'HH24:MI') AS in_time,
           to_char(j.clock_out AT TIME ZONE tz.z, 'HH24:MI') AS out_time,
           (extract(epoch FROM coalesce(j.clock_out, now()) - j.clock_in) / 60)::int AS minutes,
           j.work_order_id, w.number AS work_order_number, c.display_name AS customer,
           trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle
    FROM grip.job_time_entries j CROSS JOIN tz
    JOIN grip.employees e ON e.id = j.employee_id
    JOIN grip.work_orders w ON w.id = j.work_order_id
    JOIN grip.customers c ON c.id = w.customer_id
    JOIN grip.vehicles v ON v.id = w.vehicle_id
    WHERE j.clock_in >= (${from}::text::date)::timestamp AT TIME ZONE tz.z
      AND j.clock_in <  (${to}::text::date)::timestamp   AT TIME ZONE tz.z
      ${employeeId ? tx`AND j.employee_id = ${employeeId}` : tx``}
    ORDER BY j.clock_in DESC LIMIT 1000`);
}

/** Shift minutes per person in a range, to set job time against. */
export async function shiftMinutesByPerson(session: Session, from: string, to: string) {
  const rows = await inShop(session, (tx) => tx<{ employee_id: string; minutes: number }[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT t.employee_id,
           coalesce(sum(extract(epoch FROM coalesce(t.clock_out, now()) - t.clock_in) / 60), 0)::int AS minutes
    FROM grip.time_entries t CROSS JOIN tz
    WHERE t.clock_in >= (${from}::text::date)::timestamp AT TIME ZONE tz.z
      AND t.clock_in <  (${to}::text::date)::timestamp   AT TIME ZONE tz.z
    GROUP BY t.employee_id`);
  return new Map(rows.map((r) => [r.employee_id, r.minutes]));
}

export async function myClock(session: Session) {
  return inShop(session, async (tx) => {
    const [emp] = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM grip.employees WHERE id = grip.my_employee_id()`;
    if (!emp) return null;

    const [open] = await tx<
      { id: string; since_time: string; minutes: number; work_order_id: string | null; work_order_number: number | null }[]
    >`
      SELECT t.id, to_char(t.clock_in AT TIME ZONE grip.shop_timezone(), 'FMHH12:MI AM') AS since_time,
             (extract(epoch FROM now() - t.clock_in) / 60)::int AS minutes,
             t.work_order_id, w.number AS work_order_number
      FROM grip.time_entries t LEFT JOIN grip.work_orders w ON w.id = t.work_order_id
      WHERE t.employee_id = ${emp.id} AND t.clock_out IS NULL`;

    const [job] = await tx<
      { id: string; since_time: string; minutes: number; work_order_id: string; work_order_number: number;
        customer: string; vehicle: string }[]
    >`
      SELECT j.id, to_char(j.clock_in AT TIME ZONE grip.shop_timezone(), 'FMHH12:MI AM') AS since_time,
             (extract(epoch FROM now() - j.clock_in) / 60)::int AS minutes,
             j.work_order_id, w.number AS work_order_number, c.display_name AS customer,
             trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle
      FROM grip.job_time_entries j
      JOIN grip.work_orders w ON w.id = j.work_order_id
      JOIN grip.customers c ON c.id = w.customer_id
      JOIN grip.vehicles v ON v.id = w.vehicle_id
      WHERE j.employee_id = ${emp.id} AND j.clock_out IS NULL`;

    const [jobHrs] = await tx<{ today: string }[]>`
      WITH tz AS (SELECT grip.shop_timezone() AS z)
      SELECT coalesce(sum(extract(epoch FROM coalesce(j.clock_out, now()) - j.clock_in) / 3600.0), 0)::numeric(8,2) AS today
      FROM grip.job_time_entries j CROSS JOIN tz
      WHERE j.employee_id = ${emp.id}
        AND j.clock_in >= date_trunc('day', now() AT TIME ZONE tz.z) AT TIME ZONE tz.z`;

    // Hours so far today and this week (Monday start), in the shop's calendar.
    const [hrs] = await tx<{ today: string; week: string }[]>`
      WITH tz AS (SELECT grip.shop_timezone() AS z),
           d AS (SELECT date_trunc('day', now() AT TIME ZONE tz.z) AS day,
                        date_trunc('week', now() AT TIME ZONE tz.z) AS wk, tz.z FROM tz)
      SELECT
        coalesce(sum(extract(epoch FROM coalesce(t.clock_out, now()) - t.clock_in) / 3600.0)
          FILTER (WHERE t.clock_in >= d.day AT TIME ZONE d.z), 0)::numeric(8,2) AS today,
        coalesce(sum(extract(epoch FROM coalesce(t.clock_out, now()) - t.clock_in) / 3600.0)
          FILTER (WHERE t.clock_in >= d.wk AT TIME ZONE d.z), 0)::numeric(8,2) AS week
      FROM grip.time_entries t CROSS JOIN d
      WHERE t.employee_id = ${emp.id} AND t.clock_in >= d.wk AT TIME ZONE d.z`;

    // Jobs they could clock onto: open work orders they can see.
    const orders = await tx<{ id: string; number: number; customer: string; vehicle: string }[]>`
      SELECT w.id, w.number, c.display_name AS customer,
             trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle
      FROM grip.work_orders w
      JOIN grip.customers c ON c.id = w.customer_id
      JOIN grip.vehicles v ON v.id = w.vehicle_id
      WHERE w.status IN ('quote', 'approved', 'in_progress')
        ${session.role === "technician"
          ? tx`AND (EXISTS (SELECT 1 FROM grip.work_order_labour_lines l WHERE l.work_order_id = w.id AND l.tech_id = ${emp.id})
                 OR EXISTS (SELECT 1 FROM grip.appointments a WHERE a.id = w.appointment_id AND a.assigned_tech_id = ${emp.id}))`
          : tx``}
      ORDER BY w.number DESC LIMIT 40`;

    return {
      employee: emp, open: open ?? null, job: job ?? null, jobToday: Number(jobHrs?.today ?? 0),
      today: Number(hrs?.today ?? 0), week: Number(hrs?.week ?? 0), orders,
    };
  });
}

export function whoIsOnClock(session: Session) {
  return inShop(session, (tx) => tx<
    { employee_id: string; full_name: string; since_time: string; minutes: number; work_order_number: number | null }[]
  >`
    SELECT e.id AS employee_id, e.full_name,
           to_char(t.clock_in AT TIME ZONE grip.shop_timezone(), 'FMHH12:MI AM') AS since_time,
           (extract(epoch FROM now() - t.clock_in) / 60)::int AS minutes, w.number AS work_order_number
    FROM grip.time_entries t
    JOIN grip.employees e ON e.id = t.employee_id
    LEFT JOIN grip.job_time_entries j ON j.employee_id = t.employee_id AND j.clock_out IS NULL
    LEFT JOIN grip.work_orders w ON w.id = coalesce(j.work_order_id, t.work_order_id)
    WHERE t.clock_out IS NULL ORDER BY t.clock_in`);
}

// --- settings ----------------------------------------------------------------------

export type Settings = {
  legal_name: string | null; address_line1: string | null; city: string | null;
  region: string | null; postal_code: string | null; country: string; phone: string | null;
  email: string | null; logo_url: string | null; invoice_footer: string | null;
  default_labour_rate: string; labour_billing_mode: "flat_rate" | "straight_time";
  timezone: string; open_hour: number; close_hour: number; default_tax_rate_id: string | null;
  hst_number: string | null;
};

export async function getSettings(session: Session) {
  const [row] = await inShop(session, (tx) => tx<(Settings & { shop_name: string })[]>`
    SELECT t.name AS shop_name,
           s.legal_name, s.address_line1, s.city, s.region, s.postal_code,
           coalesce(s.country, 'CA') AS country, s.phone, s.email, s.logo_url, s.invoice_footer,
           coalesce(s.default_labour_rate, 120) AS default_labour_rate,
           coalesce(s.labour_billing_mode, 'flat_rate') AS labour_billing_mode,
           coalesce(s.timezone, 'America/Vancouver') AS timezone,
           coalesce(s.open_hour, 7) AS open_hour, coalesce(s.close_hour, 18) AS close_hour,
           s.default_tax_rate_id, s.hst_number
    FROM grip.tenants t LEFT JOIN grip.tenant_settings s ON s.tenant_id = t.id
    WHERE t.id = ${session.tenantId}`);
  return row;
}

/**
 * The shop's HST rate, plus a count of anything it had before Ontario-only tax.
 * Retired rates still sit behind old documents, so the settings page can say so
 * rather than leave the shop wondering where their old rates went.
 */
export async function getTaxSetup(session: Session) {
  const [row] = await inShop(session, (tx) => tx<
    { hst_bps: number | null; exempt_exists: boolean; retired: number }[]
  >`
    SELECT (SELECT c.rate_bps
            FROM grip.tax_rates r JOIN grip.tax_rate_components c ON c.tax_rate_id = r.id
            WHERE lower(r.name) = 'hst' ORDER BY c.sort_order LIMIT 1) AS hst_bps,
           EXISTS (SELECT 1 FROM grip.tax_rates WHERE lower(name) = 'exempt' AND is_active) AS exempt_exists,
           (SELECT count(*)::int FROM grip.tax_rates
            WHERE NOT is_active AND lower(name) NOT IN ('hst', 'exempt')) AS retired`);
  return row;
}

// --- reports -----------------------------------------------------------------------

export type RevenueRow = {
  period: string; labour: string; parts: string; tax: string; parts_cost: string;
  billed_hours: string; documents: string;
};
export type PayrollRow = { period: string; clocked_hours: string; payroll_cost: string };
export type TechRow = {
  employee_id: string; full_name: string; hourly_rate: string; billed_hours: string;
  actual_hours: string; labour_revenue: string; clocked_hours: string; payroll_cost: string;
};
export type Projection = {
  today: string; month_start: string; mtd_revenue: string; trailing_28: string;
  avg_daily: string; days_remaining: number; projected_month: string;
  wip_orders: string; wip_value: string; quote_orders: string; quote_value: string;
  booked_hours_7d: string;
};

export async function getReport(
  session: Session, from: string, to: string, grain: "day" | "week" | "month",
) {
  return inShop(session, async (tx) => {
    const revenue = await tx<RevenueRow[]>`
      SELECT * FROM grip.report_revenue(${from}::text::date, ${to}::text::date, ${grain})`;
    const payroll = await tx<PayrollRow[]>`
      SELECT * FROM grip.report_labour_cost(${from}::text::date, ${to}::text::date, ${grain})`;
    const techs = await tx<TechRow[]>`
      SELECT * FROM grip.report_technicians(${from}::text::date, ${to}::text::date)`;
    const [projection] = await tx<Projection[]>`
      SELECT to_char(today, 'YYYY-MM-DD') AS today, to_char(month_start, 'YYYY-MM-DD') AS month_start,
             mtd_revenue, trailing_28, avg_daily, days_remaining, projected_month,
             wip_orders, wip_value, quote_orders, quote_value, booked_hours_7d
      FROM grip.report_projection()`;
    return { revenue, payroll, techs, projection };
  });
}

// --- time off ----------------------------------------------------------------------

export type TimeOffRow = {
  id: string; employee_id: string; full_name: string;
  from_date: string; to_date: string; days: number; note: string | null;
  status: "pending" | "approved" | "declined" | "cancelled";
  recipient_user_id: string | null; recipient_name: string | null;
  decided_by_name: string | null; decision_note: string | null; decided_at: Date | null;
  created_at: Date;
};

const TIME_OFF = (tx: import("postgres").TransactionSql) => tx`
  SELECT r.id, r.employee_id, e.full_name,
         to_char(r.from_date, 'YYYY-MM-DD') AS from_date, to_char(r.to_date, 'YYYY-MM-DD') AS to_date,
         (r.to_date - r.from_date + 1)::int AS days, r.note, r.status::text AS status,
         r.recipient_user_id, ru.full_name AS recipient_name,
         du.full_name AS decided_by_name, r.decision_note, r.decided_at, r.created_at
  FROM grip.time_off_requests r
  JOIN grip.employees e ON e.id = r.employee_id
  LEFT JOIN grip.users ru ON ru.id = r.recipient_user_id
  LEFT JOIN grip.users du ON du.id = r.decided_by`;

/** One person's requests, newest first. */
export function listMyTimeOff(session: Session, employeeId: string) {
  return inShop(session, (tx) => tx<TimeOffRow[]>`
    ${TIME_OFF(tx)} WHERE r.employee_id = ${employeeId} ORDER BY r.from_date DESC LIMIT 100`);
}

/** Requests waiting on this person: sent to them, or — for an administrator — to anyone. */
export function listTimeOffToAnswer(session: Session, includeAll: boolean) {
  return inShop(session, (tx) => tx<TimeOffRow[]>`
    ${TIME_OFF(tx)}
    WHERE r.status = 'pending'
      AND r.employee_id IS DISTINCT FROM grip.my_employee_id()
      ${includeAll ? tx`` : tx`AND r.recipient_user_id = ${session.userId}`}
    ORDER BY r.from_date LIMIT 100`);
}

/** Everything, for the administrator's view: pending first, then upcoming, then history. */
export function listAllTimeOff(session: Session) {
  return inShop(session, (tx) => tx<TimeOffRow[]>`
    ${TIME_OFF(tx)}
    ORDER BY (r.status = 'pending') DESC, r.to_date >= (now() AT TIME ZONE grip.shop_timezone())::date DESC,
             r.from_date LIMIT 300`);
}

export async function pendingTimeOffCount(session: Session, includeAll: boolean) {
  const [row] = await inShop(session, (tx) => tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM grip.time_off_requests r
    WHERE r.status = 'pending'
      AND r.employee_id IS DISTINCT FROM grip.my_employee_id()
      ${includeAll ? tx`` : tx`AND r.recipient_user_id = ${session.userId}`}`);
  return row?.n ?? 0;
}

/** Who a request can be sent to: everyone with a login here except you. */
export function timeOffRecipients(session: Session) {
  return inShop(session, (tx) => tx<{ id: string; full_name: string; role: string }[]>`
    SELECT id, full_name, role::text AS role FROM grip.users
    WHERE is_active AND id <> ${session.userId}
    ORDER BY (role = 'shop_admin') DESC, full_name`);
}

/** Time off overlapping a window, for painting onto a calendar. */
export function listTimeOffBetween(session: Session, from: string, to: string, employeeId?: string) {
  return inShop(session, (tx) => tx<TimeOffRow[]>`
    ${TIME_OFF(tx)}
    WHERE r.status IN ('pending', 'approved')
      AND r.from_date < ${to}::text::date AND r.to_date >= ${from}::text::date
      ${employeeId ? tx`AND r.employee_id = ${employeeId}` : tx``}
    ORDER BY r.from_date`);
}
