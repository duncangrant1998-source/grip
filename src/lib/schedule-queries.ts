import "server-only";
import { inShop } from "./auth";
import type { Session } from "./session";

/**
 * Every time that leaves the database here has already been converted to the
 * SHOP's wall clock and is returned as plain strings and minute counts. Never
 * select a bare `timestamp` and let the driver parse it: postgres.js
 * reinterprets it in the server's local timezone, which silently shifts it.
 */

export type ScheduleContext = {
  timezone: string;
  open_hour: number;
  close_hour: number;
  today: string;      // YYYY-MM-DD at the shop
  now_min: number;    // minutes since local midnight at the shop
};

export async function getScheduleContext(session: Session): Promise<ScheduleContext> {
  const [row] = await inShop(session, (tx) => tx<ScheduleContext[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT tz.z AS timezone,
           coalesce(s.open_hour, 7)  AS open_hour,
           coalesce(s.close_hour, 18) AS close_hour,
           to_char(now() AT TIME ZONE tz.z, 'YYYY-MM-DD') AS today,
           (extract(hour FROM now() AT TIME ZONE tz.z) * 60
            + extract(minute FROM now() AT TIME ZONE tz.z))::int AS now_min
    FROM tz
    LEFT JOIN grip.tenant_settings s ON s.tenant_id = grip.current_tenant_id()`);
  return row;
}

export type Bay = { id: string; name: string; is_active: boolean };

export function listBays(session: Session, includeInactive = false) {
  return inShop(session, (tx) => tx<Bay[]>`
    SELECT id, name, is_active FROM grip.bays
    WHERE ${includeInactive ? tx`true` : tx`is_active`}
    ORDER BY sort_order, name`);
}

export type CalendarItem = {
  id: string;
  local_date: string;
  start_min: number;
  minutes: number;
  status: string;
  bay_id: string | null;
  bay_name: string | null;
  tech_id: string | null;
  tech_name: string | null;
  customer_name: string;
  vehicle: string;
  concern: string | null;
  work_order_id: string | null;
  work_order_number: number | null;
};

/** Appointments whose local start date is in [from, to). Cancelled and no-shows are left off the grid. */
export function listCalendar(session: Session, from: string, to: string) {
  const isTech = session.role === "technician";
  return inShop(session, (tx) => tx<CalendarItem[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z)
    SELECT a.id,
           to_char(a.starts_at AT TIME ZONE tz.z, 'YYYY-MM-DD') AS local_date,
           (extract(hour FROM a.starts_at AT TIME ZONE tz.z) * 60
            + extract(minute FROM a.starts_at AT TIME ZONE tz.z))::int AS start_min,
           a.estimated_minutes AS minutes, a.status,
           a.bay_id, b.name AS bay_name, a.assigned_tech_id AS tech_id, e.full_name AS tech_name,
           c.display_name AS customer_name,
           trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle,
           a.concern, w.id AS work_order_id, w.number AS work_order_number
    FROM grip.appointments a
    CROSS JOIN tz
    JOIN grip.customers c ON c.id = a.customer_id
    JOIN grip.vehicles  v ON v.id = a.vehicle_id
    LEFT JOIN grip.bays b ON b.id = a.bay_id
    LEFT JOIN grip.employees e ON e.id = a.assigned_tech_id
    LEFT JOIN grip.work_orders w ON w.appointment_id = a.id
    WHERE a.status NOT IN ('cancelled', 'no_show')
      AND a.starts_at >= (${from}::text::date)::timestamp AT TIME ZONE tz.z
      AND a.starts_at <  (${to}::text::date)::timestamp   AT TIME ZONE tz.z
      ${isTech
        ? tx`AND a.assigned_tech_id IN (SELECT id FROM grip.employees WHERE user_id = ${session.userId})`
        : tx``}
    ORDER BY a.starts_at`);
}

export type AppointmentDetail = CalendarItem & {
  customer_id: string;
  customer_phone: string | null;
  vehicle_id: string;
  vin: string | null;
  plate: string | null;
  start_time: string;   // HH24:MI at the shop
  end_min: number;
  created_by_name: string | null;
};

export async function getAppointment(session: Session, id: string) {
  const isTech = session.role === "technician";
  return inShop(session, async (tx) => {
    const [appt] = await tx<AppointmentDetail[]>`
      WITH tz AS (SELECT grip.shop_timezone() AS z)
      SELECT a.id,
             to_char(a.starts_at AT TIME ZONE tz.z, 'YYYY-MM-DD') AS local_date,
             to_char(a.starts_at AT TIME ZONE tz.z, 'HH24:MI') AS start_time,
             (extract(hour FROM a.starts_at AT TIME ZONE tz.z) * 60
              + extract(minute FROM a.starts_at AT TIME ZONE tz.z))::int AS start_min,
             a.estimated_minutes AS minutes,
             (extract(hour FROM a.starts_at AT TIME ZONE tz.z) * 60
              + extract(minute FROM a.starts_at AT TIME ZONE tz.z))::int + a.estimated_minutes AS end_min,
             a.status, a.bay_id, b.name AS bay_name,
             a.assigned_tech_id AS tech_id, e.full_name AS tech_name,
             c.id AS customer_id, c.display_name AS customer_name, c.phone AS customer_phone,
             v.id AS vehicle_id, v.vin, v.plate,
             trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle,
             a.concern, w.id AS work_order_id, w.number AS work_order_number,
             u.full_name AS created_by_name
      FROM grip.appointments a
      CROSS JOIN tz
      JOIN grip.customers c ON c.id = a.customer_id
      JOIN grip.vehicles  v ON v.id = a.vehicle_id
      LEFT JOIN grip.bays b ON b.id = a.bay_id
      LEFT JOIN grip.employees e ON e.id = a.assigned_tech_id
      LEFT JOIN grip.work_orders w ON w.appointment_id = a.id
      LEFT JOIN grip.users u ON u.id = a.created_by
      WHERE a.id = ${id}
        ${isTech
          ? tx`AND a.assigned_tech_id IN (SELECT id FROM grip.employees WHERE user_id = ${session.userId})`
          : tx``}`;
    if (!appt) return null;

    const audit = await tx<
      { id: string; action: string; created_at: Date; actor: string | null;
        diff: Record<string, unknown> | null }[]
    >`SELECT a.id::text, a.action, a.created_at, u.full_name AS actor, a.diff
      FROM grip.audit_log a LEFT JOIN grip.users u ON u.id = a.actor_user_id
      WHERE a.entity = 'appointment' AND a.entity_id = ${id}
      ORDER BY a.id DESC LIMIT 30`;

    return { appt, audit };
  });
}

/** Today's appointment count in the SHOP's day, for the dashboard. */
export async function countToday(session: Session): Promise<number> {
  const isTech = session.role === "technician";
  const [row] = await inShop(session, (tx) => tx<{ n: string }[]>`
    WITH tz AS (SELECT grip.shop_timezone() AS z),
         d  AS (SELECT date_trunc('day', now() AT TIME ZONE tz.z) AS local_start, tz.z FROM tz)
    SELECT count(*) AS n
    FROM grip.appointments a CROSS JOIN d
    WHERE a.status NOT IN ('cancelled', 'no_show')
      AND a.starts_at >= d.local_start AT TIME ZONE d.z
      AND a.starts_at <  (d.local_start + interval '1 day') AT TIME ZONE d.z
      ${isTech
        ? tx`AND a.assigned_tech_id IN (SELECT id FROM grip.employees WHERE user_id = ${session.userId})`
        : tx``}`);
  return Number(row.n);
}

export type BayUsage = Bay & {
  appointments: number;   // every appointment ever booked into it
  upcoming: number;       // still to come, so it can't be retired or deleted
};

/** Bays with enough history to decide whether one can be deleted or only retired. */
export function listBaysWithUsage(session: Session) {
  return inShop(session, (tx) => tx<BayUsage[]>`
    SELECT b.id, b.name, b.is_active,
           (SELECT count(*)::int FROM grip.appointments a WHERE a.bay_id = b.id) AS appointments,
           (SELECT count(*)::int FROM grip.appointments a
            WHERE a.bay_id = b.id AND a.starts_at >= now()
              AND a.status IN ('scheduled', 'confirmed', 'arrived', 'in_progress')) AS upcoming
    FROM grip.bays b
    ORDER BY b.sort_order, b.name`);
}
