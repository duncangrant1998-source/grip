import "server-only";
import { decodeVin, looksLikeVin } from "@/lib/vin";
import { inShop } from "./auth";
import type { Session } from "./session";

// --- inventory ----------------------------------------------------------------

export type PartRow = {
  id: string; sku: string; description: string; category: string | null; subcategory: string | null;
  bin_location: string | null; unit_cost: string; unit_price: string;
  fitment: string | null;
  reorder_point: number; supplier_name: string | null;
  on_hand: number; reserved: number; on_order: number; available: number;
};

export type PartView = "all" | "low" | "out" | "ordered";

export function listParts(
  session: Session,
  opts: { q: string; view: PartView; category?: string; subcategory?: string; vehicle?: PartVehicle | null },
) {
  const like = "%" + opts.q + "%";
  const fit = vehicleLike(opts.vehicle);
  return inShop(session, (tx) => tx<PartRow[]>`
    SELECT * FROM (
      SELECT p.id, p.sku, p.description, p.category, p.subcategory, p.bin_location, p.unit_cost,
             p.unit_price, p.reorder_point, sup.name AS supplier_name,
             coalesce(s.qty_on_hand, 0)  AS on_hand,
             coalesce(s.qty_reserved, 0) AS reserved,
             coalesce(s.qty_on_order, 0) AS on_order,
             coalesce(s.qty_on_hand - s.qty_reserved, 0) AS available
      FROM grip.parts p
      LEFT JOIN grip.part_stock s ON s.part_id = p.id
      LEFT JOIN grip.suppliers sup ON sup.id = p.supplier_id
      WHERE p.is_active
        ${opts.vehicle
          ? tx`AND (p.fitment ILIKE ${fit} OR p.description ILIKE ${fit})`
          : opts.q
          ? tx`AND (p.sku ILIKE ${like} OR p.description ILIKE ${like}
                    OR p.category ILIKE ${like} OR p.subcategory ILIKE ${like}
                    OR p.bin_location ILIKE ${like} OR p.fitment ILIKE ${like})`
          : tx``}
        ${opts.category === "__none__" ? tx`AND p.category IS NULL`
          : opts.category ? tx`AND p.category = ${opts.category}` : tx``}
        ${opts.subcategory === "__none__" ? tx`AND p.subcategory IS NULL`
          : opts.subcategory ? tx`AND p.subcategory = ${opts.subcategory}` : tx``}
    ) x
    WHERE true
      ${opts.view === "low" ? tx`AND x.reorder_point > 0 AND x.available <= x.reorder_point` : tx``}
      ${opts.view === "out" ? tx`AND x.available <= 0` : tx``}
      ${opts.view === "ordered" ? tx`AND x.on_order > 0` : tx``}
    ORDER BY x.category NULLS LAST, x.subcategory NULLS LAST, x.sku
    LIMIT 500`);
}

/** The vehicle a VIN stands for, when a parts search was given a VIN instead of words. */
export type PartVehicle = { label: string; make: string | null; model: string | null };

/**
 * A search box that also takes a VIN. A VIN is decoded to a vehicle and the
 * search becomes "parts for that vehicle"; anything else is an ordinary search.
 */
export async function resolvePartSearch(q: string): Promise<{
  q: string; vehicle: PartVehicle | null; vinError: string | null;
}> {
  if (!looksLikeVin(q)) return { q, vehicle: null, vinError: null };
  const d = await decodeVin(q);
  if ("error" in d) return { q, vehicle: null, vinError: d.error };
  return {
    q,
    vehicle: { label: [d.year, d.make, d.model, d.trim].filter(Boolean).join(" "), make: d.make, model: d.model },
    vinError: null,
  };
}

/** Model is the specific part of a vehicle ("Camry"); fall back to make if that is all there is. */
export function vehicleLike(v?: PartVehicle | null) {
  return "%" + (v?.model ?? v?.make ?? "") + "%";
}

export type CategoryCount = { category: string | null; subcategory: string | null; n: number };

/** Every category / sub-category pair in use, with how many active parts each holds. */
export function categoryCounts(session: Session) {
  return inShop(session, (tx) => tx<CategoryCount[]>`
    SELECT category, subcategory, count(*)::int AS n
    FROM grip.parts WHERE is_active
    GROUP BY category, subcategory
    ORDER BY category NULLS LAST, subcategory NULLS LAST`);
}

export async function inventorySummary(session: Session) {
  const [row] = await inShop(session, (tx) => tx<
    { skus: string; low: string; out: string; value: string; open_pos: string }[]
  >`
    SELECT
      count(*) FILTER (WHERE p.is_active) AS skus,
      count(*) FILTER (WHERE p.is_active AND p.reorder_point > 0
                         AND coalesce(s.qty_on_hand - s.qty_reserved, 0) <= p.reorder_point) AS low,
      count(*) FILTER (WHERE p.is_active AND coalesce(s.qty_on_hand - s.qty_reserved, 0) <= 0) AS out,
      coalesce(sum(coalesce(s.qty_on_hand, 0) * p.unit_cost) FILTER (WHERE p.is_active), 0) AS value,
      (SELECT count(*) FROM grip.purchase_orders WHERE status IN ('draft','ordered','partial')) AS open_pos
    FROM grip.parts p LEFT JOIN grip.part_stock s ON s.part_id = p.id`);
  return {
    skus: Number(row.skus), low: Number(row.low), out: Number(row.out),
    value: row.value, openPos: Number(row.open_pos),
  };
}

export type PartDetail = {
  id: string; sku: string; description: string; category: string | null; subcategory: string | null;
  bin_location: string | null; unit_cost: string; unit_price: string;
  fitment: string | null;
  reorder_point: number; reorder_qty: number; supplier_id: string | null;
  is_stocked: boolean; is_active: boolean;
  on_hand: number; reserved: number; on_order: number;
};

export type Movement = {
  id: string; kind: string; delta: number; note: string | null;
  ref_type: string | null; ref_id: string | null; created_at: Date; who: string | null;
};

export async function getPart(session: Session, id: string) {
  return inShop(session, async (tx) => {
    const [part] = await tx<PartDetail[]>`
      SELECT p.id, p.sku, p.description, p.category, p.subcategory, p.fitment, p.bin_location, p.unit_cost, p.unit_price,
             p.reorder_point, p.reorder_qty, p.supplier_id, p.is_stocked, p.is_active,
             coalesce(s.qty_on_hand, 0) AS on_hand, coalesce(s.qty_reserved, 0) AS reserved,
             coalesce(s.qty_on_order, 0) AS on_order
      FROM grip.parts p LEFT JOIN grip.part_stock s ON s.part_id = p.id
      WHERE p.id = ${id}`;
    if (!part) return null;

    const movements = await tx<Movement[]>`
      SELECT m.id::text, m.kind, m.delta, m.note, m.ref_type, m.ref_id, m.created_at,
             u.full_name AS who
      FROM grip.stock_movements m LEFT JOIN grip.users u ON u.id = m.user_id
      WHERE m.part_id = ${id} ORDER BY m.id DESC LIMIT 40`;

    // Which open jobs are holding this stock.
    const holds = await tx<
      { work_order_id: string; number: number; status: string; customer: string;
        qty_reserved: number; qty_backordered: number }[]
    >`SELECT w.id AS work_order_id, w.number, w.status, c.display_name AS customer,
             pl.qty_reserved, pl.qty_backordered
      FROM grip.work_order_part_lines pl
      JOIN grip.work_orders w ON w.id = pl.work_order_id
      JOIN grip.customers c ON c.id = w.customer_id
      WHERE pl.part_id = ${id} AND (pl.qty_reserved > 0 OR pl.qty_backordered > 0)
        AND w.status IN ('quote', 'approved', 'in_progress')
      ORDER BY w.number`;

    const onOrder = await tx<
      { po_id: string; number: number; status: string; supplier: string; outstanding: number; expected_at: Date | null }[]
    >`SELECT po.id AS po_id, po.number, po.status, sup.name AS supplier,
             (l.qty_ordered - l.qty_received) AS outstanding, po.expected_at
      FROM grip.purchase_order_lines l
      JOIN grip.purchase_orders po ON po.id = l.purchase_order_id
      JOIN grip.suppliers sup ON sup.id = po.supplier_id
      WHERE l.part_id = ${id} AND po.status IN ('ordered', 'partial')
        AND l.qty_ordered > l.qty_received
      ORDER BY po.expected_at NULLS LAST`;

    return { part, movements, holds, onOrder };
  });
}

// --- suppliers and reordering ---------------------------------------------------

export type SupplierRow = {
  id: string; name: string; account_no: string | null; phone: string | null;
  email: string | null; lead_time_days: number; is_active: boolean;
  address_line1: string | null; city: string | null; region: string | null;
  postal_code: string | null; hours: string | null; delivery_notes: string | null;
  parts: string; open_pos: string;
};

export function listSuppliers(session: Session) {
  return inShop(session, (tx) => tx<SupplierRow[]>`
    SELECT s.id, s.name, s.account_no, s.phone, s.email, s.lead_time_days, s.is_active,
           s.address_line1, s.city, s.region, s.postal_code, s.hours, s.delivery_notes,
           (SELECT count(*) FROM grip.parts p WHERE p.supplier_id = s.id AND p.is_active) AS parts,
           (SELECT count(*) FROM grip.purchase_orders po
              WHERE po.supplier_id = s.id AND po.status IN ('draft','ordered','partial')) AS open_pos
    FROM grip.suppliers s ORDER BY s.is_active DESC, s.name`);
}

export function activeSuppliers(session: Session) {
  return inShop(session, (tx) => tx<{ id: string; name: string }[]>`
    SELECT id, name FROM grip.suppliers WHERE is_active ORDER BY name`);
}

export type ReorderGroup = {
  supplier_id: string | null; supplier_name: string | null;
  items: { id: string; sku: string; description: string; available: number;
           on_order: number; reorder_point: number; suggested: number }[];
};

/** Everything at or below its reorder point, counting stock already on order. */
export async function reorderSuggestions(session: Session): Promise<ReorderGroup[]> {
  const rows = await inShop(session, (tx) => tx<
    { id: string; sku: string; description: string; supplier_id: string | null;
      supplier_name: string | null; available: number; on_order: number;
      reorder_point: number; reorder_qty: number }[]
  >`
    SELECT p.id, p.sku, p.description, p.supplier_id, sup.name AS supplier_name,
           coalesce(s.qty_on_hand - s.qty_reserved, 0) AS available,
           coalesce(s.qty_on_order, 0) AS on_order, p.reorder_point, p.reorder_qty
    FROM grip.parts p
    LEFT JOIN grip.part_stock s ON s.part_id = p.id
    LEFT JOIN grip.suppliers sup ON sup.id = p.supplier_id
    WHERE p.is_active AND p.is_stocked AND p.reorder_point > 0
      AND coalesce(s.qty_on_hand - s.qty_reserved, 0) + coalesce(s.qty_on_order, 0) <= p.reorder_point
    ORDER BY sup.name NULLS LAST, p.sku`);

  const groups = new Map<string, ReorderGroup>();
  for (const r of rows) {
    const key = r.supplier_id ?? "none";
    if (!groups.has(key)) {
      groups.set(key, { supplier_id: r.supplier_id, supplier_name: r.supplier_name, items: [] });
    }
    // Mirrors create_reorder_po(): reorder_qty if set, otherwise top up to twice the point.
    const position = r.available + r.on_order;
    groups.get(key)!.items.push({
      id: r.id, sku: r.sku, description: r.description, available: r.available,
      on_order: r.on_order, reorder_point: r.reorder_point,
      suggested: r.reorder_qty > 0 ? r.reorder_qty : Math.max(r.reorder_point * 2 - position, 1),
    });
  }
  return [...groups.values()];
}

// --- purchase orders ------------------------------------------------------------

export type PoRow = {
  id: string; number: number; status: string; supplier_name: string;
  total: string; expected_at: Date | null; lines: string; created_at: Date;
};

export function listPurchaseOrders(session: Session, scope: "open" | "closed" | "all") {
  return inShop(session, (tx) => tx<PoRow[]>`
    SELECT po.id, po.number, po.status, sup.name AS supplier_name, po.total,
           po.expected_at, po.created_at,
           (SELECT count(*) FROM grip.purchase_order_lines l WHERE l.purchase_order_id = po.id) AS lines
    FROM grip.purchase_orders po JOIN grip.suppliers sup ON sup.id = po.supplier_id
    WHERE true
      ${scope === "open" ? tx`AND po.status IN ('draft','ordered','partial')` : tx``}
      ${scope === "closed" ? tx`AND po.status IN ('received','cancelled')` : tx``}
    ORDER BY po.created_at DESC LIMIT 200`);
}

export type PoLine = {
  id: string; part_id: string; sku: string; description: string; bin_location: string | null;
  qty_ordered: number; qty_received: number; unit_cost: string; on_hand: number;
};

export async function getPurchaseOrder(session: Session, id: string) {
  return inShop(session, async (tx) => {
    const [po] = await tx<
      { id: string; number: number; status: string; supplier_id: string; supplier_name: string;
        supplier_phone: string | null; expected_at: Date | null; tax_rate_id: string | null;
        subtotal: string; tax_total: string; total: string; created_at: Date; created_by: string | null }[]
    >`SELECT po.id, po.number, po.status, po.supplier_id, sup.name AS supplier_name,
             sup.phone AS supplier_phone, po.expected_at, po.tax_rate_id,
             po.subtotal, po.tax_total, po.total, po.created_at, u.full_name AS created_by
      FROM grip.purchase_orders po
      JOIN grip.suppliers sup ON sup.id = po.supplier_id
      LEFT JOIN grip.users u ON u.id = po.created_by
      WHERE po.id = ${id}`;
    if (!po) return null;

    const lines = await tx<PoLine[]>`
      SELECT l.id, l.part_id, p.sku, p.description, p.bin_location,
             l.qty_ordered, l.qty_received, l.unit_cost,
             coalesce(s.qty_on_hand, 0) AS on_hand
      FROM grip.purchase_order_lines l
      JOIN grip.parts p ON p.id = l.part_id
      LEFT JOIN grip.part_stock s ON s.part_id = l.part_id
      WHERE l.purchase_order_id = ${id} ORDER BY p.sku`;

    const audit = await tx<{ id: string; action: string; created_at: Date; actor: string | null;
                             diff: Record<string, unknown> | null }[]>`
      SELECT a.id::text, a.action, a.created_at, u.full_name AS actor, a.diff
      FROM grip.audit_log a LEFT JOIN grip.users u ON u.id = a.actor_user_id
      WHERE a.entity = 'purchase_order' AND a.entity_id = ${id}
      ORDER BY a.id DESC LIMIT 30`;

    return { po, lines, audit };
  });
}

// --- counter sales --------------------------------------------------------------

export type SaleRow = {
  id: string; number: number; status: string; customer_name: string | null;
  total: string; sold_by: string | null; created_at: Date;
};

export function listCounterSales(session: Session, scope: "open" | "done" | "all") {
  return inShop(session, (tx) => tx<SaleRow[]>`
    SELECT s.id, s.number, s.status, s.customer_name, s.total, u.full_name AS sold_by, s.created_at
    FROM grip.counter_sales s LEFT JOIN grip.users u ON u.id = s.sold_by
    WHERE true
      ${scope === "open" ? tx`AND s.status = 'open'` : tx``}
      ${scope === "done" ? tx`AND s.status IN ('completed','cancelled')` : tx``}
    ORDER BY s.created_at DESC LIMIT 200`);
}

export type SaleLine = {
  id: string; sku: string; description: string; qty: number; unit_price: string;
  unit_cost: string; is_taxable: boolean; added_by: string | null; created_at: Date;
};

export async function getCounterSale(session: Session, id: string) {
  return inShop(session, async (tx) => {
    const [sale] = await tx<
      { id: string; number: number; status: string; customer_id: string | null;
        customer_name: string | null; tax_rate_id: string | null; subtotal: string;
        tax_total: string; total: string; sold_by: string | null; created_at: Date;
        completed_at: Date | null; exempt_reason: string | null;
        exempt_reference: string | null; is_exempt: boolean }[]
    >`SELECT s.id, s.number, s.status, s.customer_id, s.customer_name, s.tax_rate_id,
             s.subtotal, s.tax_total, s.total, u.full_name AS sold_by, s.created_at, s.completed_at,
             s.exempt_reason, s.exempt_reference, grip.rate_is_exempt(s.tax_rate_id) AS is_exempt
      FROM grip.counter_sales s LEFT JOIN grip.users u ON u.id = s.sold_by
      WHERE s.id = ${id}`;
    if (!sale) return null;

    const lines = await tx<SaleLine[]>`
      SELECT l.id, p.sku, l.description, l.qty, l.unit_price, l.unit_cost, l.is_taxable,
             u.full_name AS added_by, l.created_at
      FROM grip.counter_sale_lines l
      JOIN grip.parts p ON p.id = l.part_id
      LEFT JOIN grip.users u ON u.id = l.added_by_user_id
      WHERE l.counter_sale_id = ${id} ORDER BY l.created_at`;

    const taxes = await tx<{ component_name: string; rate_bps: number; amount: string }[]>`
      SELECT component_name, rate_bps, amount
      FROM grip.counter_sale_taxes WHERE counter_sale_id = ${id} ORDER BY sort_order`;

    return { sale, lines, taxes };
  });
}

// --- the orders the parts desk is working for ---------------------------------------

export type PartsOrderRow = {
  id: string; number: number; status: string; concern: string | null;
  customer: string; vehicle: string; plate: string | null;
  appt_when: string | null; appt_status: string | null;
  part_lines: number; backordered: number; parts_value: string; labour_lines: number;
};

/**
 * Work orders from the parts desk's point of view.
 *
 *   open     — the vehicle is in the shop now: an order that is approved, under
 *              way or finished-but-not-invoiced, or a quote for a walk-in or for
 *              someone whose appointment has begun
 *   incoming — the vehicle is booked but has not arrived: a quote or approved
 *              order tied to a scheduled or confirmed appointment
 *
 * Both are where parts get added, so each row says how many parts are already on
 * it and whether any are backordered.
 */
export function partsWorkOrders(session: Session, kind: "open" | "incoming") {
  return inShop(session, (tx) => tx<PartsOrderRow[]>`
    SELECT w.id, w.number, w.status, w.concern,
           c.display_name AS customer,
           trim(concat_ws(' ', v.year::text, v.make, v.model, v.trim)) AS vehicle, v.plate,
           CASE WHEN a.id IS NULL THEN NULL
                ELSE to_char(a.starts_at AT TIME ZONE grip.shop_timezone(), 'Dy Mon FMDD" · "FMHH12:MI AM')
           END AS appt_when,
           a.status::text AS appt_status,
           (SELECT count(*)::int FROM grip.work_order_part_lines pl WHERE pl.work_order_id = w.id) AS part_lines,
           (SELECT coalesce(sum(pl.qty_backordered), 0)::int FROM grip.work_order_part_lines pl
             WHERE pl.work_order_id = w.id) AS backordered,
           w.parts_subtotal AS parts_value,
           (SELECT count(*)::int FROM grip.work_order_labour_lines l WHERE l.work_order_id = w.id) AS labour_lines
    FROM grip.work_orders w
    JOIN grip.customers c ON c.id = w.customer_id
    JOIN grip.vehicles  v ON v.id = w.vehicle_id
    LEFT JOIN grip.appointments a ON a.id = w.appointment_id
    WHERE ${kind === "incoming"
      ? tx`w.status IN ('quote', 'approved') AND a.status IN ('scheduled', 'confirmed')`
      : tx`w.status IN ('quote', 'approved', 'in_progress', 'completed')
            AND (a.id IS NULL OR a.status NOT IN ('scheduled', 'confirmed'))`}
    ORDER BY ${kind === "incoming" ? tx`a.starts_at` : tx`w.updated_at DESC`}
    LIMIT 200`);
}
