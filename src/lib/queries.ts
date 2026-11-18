import "server-only";
import type postgres from "postgres";
import { inShop } from "./auth";
import { can } from "./permissions";
import type { Session } from "./session";

type Tx = postgres.TransactionSql;

/**
 * Technicians see only jobs they are on: ones with a labour line assigned to
 * them, or whose appointment is assigned to them. Everyone else sees every job
 * in their shop. (The shop boundary itself is row-level security; this is the
 * narrower, role-based cut inside it.)
 */
export function visibleOrders(tx: Tx, session: Session) {
  if (session.role !== "technician") return tx``;
  return tx`AND (
    EXISTS (
      SELECT 1 FROM grip.work_order_labour_lines l
      JOIN grip.employees e ON e.id = l.tech_id
      WHERE l.work_order_id = w.id AND e.user_id = ${session.userId})
    OR EXISTS (
      SELECT 1 FROM grip.appointments a
      JOIN grip.employees e ON e.id = a.assigned_tech_id
      WHERE a.id = w.appointment_id AND e.user_id = ${session.userId})
  )`;
}

/** Whether this user may touch this work order at all (shop + technician scope). */
export async function canSeeOrder(session: Session, id: string): Promise<boolean> {
  const rows = await inShop(session, (tx) => tx`
    SELECT 1 FROM grip.work_orders w WHERE w.id = ${id} ${visibleOrders(tx, session)}`);
  return rows.length > 0;
}

/** The employee record behind a login, if any — a technician's own id. */
export async function ownEmployeeId(session: Session): Promise<string | null> {
  const [row] = await inShop(session, (tx) => tx<{ id: string }[]>`
    SELECT id FROM grip.employees WHERE user_id = ${session.userId} AND is_active LIMIT 1`);
  return row?.id ?? null;
}

export type OrderRow = {
  id: string; number: number; status: string; concern: string | null;
  total: string; updated_at: Date; customer_name: string;
  vehicle: string; vin: string | null;
};

export function listOrders(
  session: Session,
  opts: { scope: "quotes" | "open" | "closed" | "all"; q?: string },
) {
  return inShop(session, (tx) => tx<OrderRow[]>`
    SELECT w.id, w.number, w.status, w.concern, w.total, w.updated_at,
           c.display_name AS customer_name,
           trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle,
           v.vin
    FROM grip.work_orders w
    JOIN grip.customers c ON c.id = w.customer_id
    JOIN grip.vehicles  v ON v.id = w.vehicle_id
    WHERE true
      ${opts.scope === "quotes"
        ? tx`AND w.status = 'quote'`
        : opts.scope === "open"
        ? tx`AND w.status IN ('approved', 'in_progress', 'completed')`
        : opts.scope === "closed"
          ? tx`AND w.status IN ('invoiced', 'paid', 'cancelled')`
          : tx``}
      ${opts.q
        ? tx`AND (w.number::text = ${opts.q}
                  OR c.display_name ILIKE ${"%" + opts.q + "%"}
                  OR v.vin ILIKE ${"%" + opts.q + "%"}
                  OR v.plate ILIKE ${"%" + opts.q + "%"}
                  OR concat_ws(' ', v.make, v.model) ILIKE ${"%" + opts.q + "%"})`
        : tx``}
      ${visibleOrders(tx, session)}
    ORDER BY w.updated_at DESC
    LIMIT 200`);
}

export type OrderDetail = {
  id: string; number: number; status: string; concern: string | null;
  mileage_in: number | null; created_at: Date; approved_at: Date | null;
  completed_at: Date | null; invoiced_at: Date | null; paid_at: Date | null;
  tax_rate_id: string | null; labour_billing_mode: "flat_rate" | "straight_time";
  exempt_reason: string | null; exempt_reference: string | null; is_exempt: boolean;
  labour_subtotal: string; parts_subtotal: string; subtotal: string;
  tax_total: string; total: string;
  customer_id: string; customer_name: string; customer_phone: string | null;
  vehicle_id: string; vehicle: string; vin: string | null; plate: string | null;
  opened_by_name: string | null;
  notes: string | null; customer_email: string | null; appointment_id: string | null;
};

export type LabourLine = {
  id: string; description: string; billed_hours: string; actual_hours: string;
  rate: string; billing_mode: string; tech_id: string | null; tech_name: string | null;
  is_taxable: boolean; added_by: string | null; created_at: Date;
  added_by_id: string | null; edited_by: string | null; edited_by_id: string | null;
  edited_at: Date | null;
};

export type PartLine = {
  id: string; part_id: string; sku: string; description: string; qty: number;
  unit_price: string; unit_cost?: string; qty_reserved: number; qty_consumed: number;
  qty_backordered: number; is_taxable: boolean; added_by: string | null; created_at: Date;
  added_by_id: string | null; edited_by: string | null; edited_by_id: string | null;
  edited_at: Date | null;
};

export type TaxLine = { component_name: string; rate_bps: number; taxable_base: string; amount: string };

export type AuditEntry = {
  id: string; action: string; created_at: Date; actor: string | null;
  diff: Record<string, unknown> | null;
};

export async function getOrder(session: Session, id: string) {
  // Part cost is visible only to roles allowed to see it. It is simply never
  // selected otherwise, so it cannot leak through a rendering mistake.
  const showCost = can(session.role, "parts.viewCost", session.extraRoles);

  return inShop(session, async (tx) => {
    const [order] = await tx<OrderDetail[]>`
      SELECT w.id, w.number, w.status, w.concern, w.mileage_in, w.created_at,
             w.approved_at, w.completed_at, w.invoiced_at, w.paid_at,
             w.tax_rate_id, w.labour_billing_mode,
             w.exempt_reason, w.exempt_reference,
             grip.rate_is_exempt(w.tax_rate_id) AS is_exempt,
             w.labour_subtotal, w.parts_subtotal, w.subtotal, w.tax_total, w.total,
             w.notes, w.appointment_id,
             c.id AS customer_id, c.display_name AS customer_name, c.phone AS customer_phone,
             c.email AS customer_email,
             v.id AS vehicle_id,
             trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle,
             v.vin, v.plate,
             ob.full_name AS opened_by_name
      FROM grip.work_orders w
      JOIN grip.customers c ON c.id = w.customer_id
      JOIN grip.vehicles  v ON v.id = w.vehicle_id
      LEFT JOIN grip.users ob ON ob.id = w.opened_by
      WHERE w.id = ${id} ${visibleOrders(tx, session)}`;

    if (!order) return null;

    const labour = await tx<LabourLine[]>`
      SELECT l.id, l.description, l.billed_hours, l.actual_hours, l.rate, l.billing_mode,
             l.tech_id, e.full_name AS tech_name, l.is_taxable,
             u.full_name AS added_by, l.added_by_user_id AS added_by_id,
             eu.full_name AS edited_by, l.edited_by_user_id AS edited_by_id, l.edited_at,
             l.created_at
      FROM grip.work_order_labour_lines l
      LEFT JOIN grip.employees e ON e.id = l.tech_id
      LEFT JOIN grip.users u ON u.id = l.added_by_user_id
      LEFT JOIN grip.users eu ON eu.id = l.edited_by_user_id
      WHERE l.work_order_id = ${id}
      ORDER BY l.created_at`;

    const parts = await tx<PartLine[]>`
      SELECT pl.id, pl.part_id, p.sku, pl.description, pl.qty, pl.unit_price,
             ${showCost ? tx`pl.unit_cost,` : tx``}
             pl.qty_reserved, pl.qty_consumed, pl.qty_backordered, pl.is_taxable,
             u.full_name AS added_by, pl.added_by_user_id AS added_by_id,
             eu.full_name AS edited_by, pl.edited_by_user_id AS edited_by_id, pl.edited_at,
             pl.created_at
      FROM grip.work_order_part_lines pl
      JOIN grip.parts p ON p.id = pl.part_id
      LEFT JOIN grip.users u ON u.id = pl.added_by_user_id
      LEFT JOIN grip.users eu ON eu.id = pl.edited_by_user_id
      WHERE pl.work_order_id = ${id}
      ORDER BY pl.created_at`;

    const taxes = await tx<TaxLine[]>`
      SELECT component_name, rate_bps, taxable_base, amount
      FROM grip.work_order_taxes WHERE work_order_id = ${id} ORDER BY sort_order`;

    const audit = await tx<AuditEntry[]>`
      SELECT a.id::text, a.action, a.created_at, u.full_name AS actor, a.diff
      FROM grip.audit_log a
      LEFT JOIN grip.users u ON u.id = a.actor_user_id
      WHERE a.entity = 'work_order' AND a.entity_id = ${id}
      ORDER BY a.id DESC LIMIT 40`;

    return { order, labour, parts, taxes, audit };
  });
}

export function listTaxRates(session: Session) {
  return inShop(session, (tx) => tx<
    { id: string; name: string; is_default: boolean; components: string }[]
  >`
    SELECT r.id, r.name, r.is_default,
           coalesce(string_agg(c.name || ' ' || (c.rate_bps / 100.0)::numeric(6,2) || '%', ' + '
                               ORDER BY c.sort_order), 'no tax') AS components
    FROM grip.tax_rates r
    LEFT JOIN grip.tax_rate_components c ON c.tax_rate_id = r.id
    WHERE r.is_active
    GROUP BY r.id
    ORDER BY r.is_default DESC, r.name`);
}

export function listTechnicians(session: Session) {
  return inShop(session, (tx) => tx<{ id: string; full_name: string; user_id: string | null }[]>`
    SELECT id, full_name, user_id FROM grip.employees
    WHERE is_active ORDER BY full_name`);
}

export type PartHit = {
  id: string; sku: string; description: string; bin_location: string | null;
  unit_price: string; unit_cost?: string; available: number; on_hand: number;
};

export function searchParts(
  session: Session, q: string, vehicle?: { make: string | null; model: string | null } | null,
) {
  const showCost = can(session.role, "parts.viewCost", session.extraRoles);
  const like = "%" + q + "%";
  const fit = "%" + (vehicle?.model ?? vehicle?.make ?? "") + "%";
  return inShop(session, (tx) => tx<PartHit[]>`
    SELECT p.id, p.sku, p.description, p.bin_location, p.unit_price,
           ${showCost ? tx`p.unit_cost,` : tx``}
           coalesce(s.qty_on_hand - s.qty_reserved, 0) AS available,
           coalesce(s.qty_on_hand, 0) AS on_hand
    FROM grip.parts p
    LEFT JOIN grip.part_stock s ON s.part_id = p.id
    WHERE p.is_active AND (${vehicle
      ? tx`p.fitment ILIKE ${fit} OR p.description ILIKE ${fit}`
      : tx`p.sku ILIKE ${like} OR p.description ILIKE ${like} OR p.fitment ILIKE ${like}`})
    ORDER BY p.sku
    LIMIT 12`);
}

// --- customers ---------------------------------------------------------------

export type CustomerRow = {
  id: string; display_name: string; phone: string | null; email: string | null;
  address: string | null; vehicles: string; open_orders: string;
};

export function listCustomers(session: Session, q: string) {
  const like = "%" + q + "%";
  return inShop(session, (tx) => tx<CustomerRow[]>`
    SELECT c.id, c.display_name, c.phone, c.email,
           nullif(concat_ws(', ', c.address_line1, c.city, c.region, c.postal_code), '') AS address,
           (SELECT count(*) FROM grip.vehicles v WHERE v.customer_id = c.id) AS vehicles,
           (SELECT count(*) FROM grip.work_orders w
             WHERE w.customer_id = c.id AND w.status IN ('quote','approved','in_progress','completed')
           ) AS open_orders
    FROM grip.customers c
    WHERE ${q
      ? tx`(c.display_name ILIKE ${like} OR c.phone ILIKE ${like} OR c.email ILIKE ${like}
            OR concat_ws(' ', c.address_line1, c.city, c.region, c.postal_code) ILIKE ${like}
            OR EXISTS (SELECT 1 FROM grip.vehicles v
                       WHERE v.customer_id = c.id
                         AND (v.vin ILIKE ${like} OR v.plate ILIKE ${like}
                              OR concat_ws(' ', v.make, v.model) ILIKE ${like})))`
      : tx`true`}
    ORDER BY c.display_name
    LIMIT 100`);
}

export type ServiceVisit = {
  id: string; number: number; status: string; concern: string | null;
  mileage_in: number | null; total: string; created_at: Date;
};

export type VehicleWithHistory = {
  id: string; year: number | null; make: string | null; model: string | null;
  trim: string | null;
  vin: string | null; plate: string | null; current_mileage: number | null;
  /** Enough to describe the vehicle while its history stays folded away. */
  visits: number; last_visit: Date | null; open_orders: number;
  history: ServiceVisit[];
};

/**
 * One customer, their vehicles, and the service history of the ONE vehicle
 * that is open. A shop with a fleet customer has no reason to pay for every
 * vehicle's history on every page load, and nobody can read it all at once
 * anyway.
 */
export async function getCustomer(session: Session, id: string, openVehicleId?: string) {
  return inShop(session, async (tx) => {
    const [customer] = await tx<
      { id: string; display_name: string; phone: string | null; email: string | null;
        address_line1: string | null; city: string | null; region: string | null;
        postal_code: string | null; notes: string | null; tax_rate_id: string | null;
        exempt_reason: string | null; exempt_reference: string | null;
        exempt_expires_on: string | null; exemption_live: boolean }[]
    >`SELECT id, display_name, phone, email, address_line1, city, region,
             postal_code, notes, tax_rate_id, exempt_reason, exempt_reference,
             to_char(exempt_expires_on, 'YYYY-MM-DD') AS exempt_expires_on,
             grip.customer_exemption_live(id) AS exemption_live
      FROM grip.customers WHERE id = ${id}`;
    if (!customer) return null;

    const vehicles = await tx<Omit<VehicleWithHistory, "history">[]>`
      SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, v.plate, v.current_mileage,
             (SELECT count(*)::int FROM grip.work_orders w WHERE w.vehicle_id = v.id) AS visits,
             (SELECT max(w.created_at) FROM grip.work_orders w WHERE w.vehicle_id = v.id) AS last_visit,
             (SELECT count(*)::int FROM grip.work_orders w
               WHERE w.vehicle_id = v.id
                 AND w.status IN ('quote','approved','in_progress','completed')) AS open_orders
      FROM grip.vehicles v WHERE v.customer_id = ${id} ORDER BY v.created_at`;

    const open = vehicles.find((v) => v.id === openVehicleId);
    const history = open
      ? await tx<ServiceVisit[]>`
          SELECT id, number, status, concern, mileage_in, total, created_at
          FROM grip.work_orders WHERE vehicle_id = ${open.id}
          ORDER BY created_at DESC`
      : [];

    return {
      customer,
      vehicles: vehicles.map((v) => ({
        ...v,
        history: v.id === open?.id ? history : [],
      })) as VehicleWithHistory[],
    };
  });
}

// --- service shortcuts ---------------------------------------------------------

export type ShortcutRow = {
  id: string; code: string; name: string; is_active: boolean;
  labour_count: number; labour_hours: string; part_count: number;
};

export function listShortcuts(session: Session) {
  return inShop(session, (tx) => tx<ShortcutRow[]>`
    SELECT s.id, s.code, s.name, s.is_active,
           (SELECT count(*)::int FROM grip.service_shortcut_labour l WHERE l.shortcut_id = s.id) AS labour_count,
           (SELECT coalesce(sum(l.hours), 0) FROM grip.service_shortcut_labour l WHERE l.shortcut_id = s.id) AS labour_hours,
           (SELECT count(*)::int FROM grip.service_shortcut_parts p WHERE p.shortcut_id = s.id) AS part_count
    FROM grip.service_shortcuts s
    ORDER BY s.is_active DESC, s.code`);
}

/** Active codes for the work order's type-ahead. */
export function shortcutCodes(session: Session) {
  return inShop(session, (tx) => tx<{ code: string; name: string }[]>`
    SELECT code, name FROM grip.service_shortcuts WHERE is_active ORDER BY code`);
}

export type ShortcutLabour = {
  id: string; description: string; hours: string; rate: string | null;
  billing_mode: "flat_rate" | "straight_time" | null; is_taxable: boolean;
};
export type ShortcutPart = {
  id: string; part_id: string; sku: string; description: string; qty: number;
  unit_price: string; available: number;
};

export async function getShortcut(session: Session, id: string) {
  return inShop(session, async (tx) => {
    const [shortcut] = await tx<{ id: string; code: string; name: string; is_active: boolean }[]>`
      SELECT id, code, name, is_active FROM grip.service_shortcuts WHERE id = ${id}`;
    if (!shortcut) return null;
    const labour = await tx<ShortcutLabour[]>`
      SELECT id, description, hours, rate, billing_mode, is_taxable
      FROM grip.service_shortcut_labour WHERE shortcut_id = ${id} ORDER BY sort_order, id`;
    const parts = await tx<ShortcutPart[]>`
      SELECT sp.id, sp.part_id, p.sku, p.description, sp.qty, p.unit_price,
             coalesce(s.qty_on_hand - s.qty_reserved, 0) AS available
      FROM grip.service_shortcut_parts sp
      JOIN grip.parts p ON p.id = sp.part_id
      LEFT JOIN grip.part_stock s ON s.part_id = p.id
      WHERE sp.shortcut_id = ${id} ORDER BY sp.sort_order, sp.id`;
    return { shortcut, labour, parts };
  });
}
