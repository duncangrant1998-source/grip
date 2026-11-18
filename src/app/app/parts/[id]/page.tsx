import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { activeSuppliers, categoryCounts, getPart } from "@/lib/parts-queries";
import { dateOnly, dateTime, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { StatusBadge } from "@/components/StatusBadge";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { adjustStock, archivePart, countStock, updatePart } from "../actions";
import { PartFields } from "../PartFields";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  receive: "bg-emerald-50 text-emerald-700",
  return: "bg-emerald-50 text-emerald-700",
  reserve: "bg-blue-50 text-blue-700",
  release: "bg-slate-100 text-slate-700",
  consume: "bg-violet-50 text-violet-700",
  sale: "bg-violet-50 text-violet-700",
  adjust: "bg-amber-50 text-amber-800",
};

function refLink(type: string | null, id: string | null) {
  if (!type || !id) return null;
  if (type === "work_order") return { href: `/app/orders/${id}`, label: "work order" };
  if (type === "purchase_order") return { href: `/app/parts/orders/${id}`, label: "purchase order" };
  if (type === "counter_sale") return { href: `/app/parts/sales/${id}`, label: "counter sale" };
  return null;
}

export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDepartment("parts");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getPart(session, id);
  if (!data) notFound();
  const { part, movements, holds, onOrder } = data;

  const canEdit = can(session.role, "inventory.edit", session.extraRoles);
  const showCost = can(session.role, "parts.viewCost", session.extraRoles);
  const [suppliers, cats] = canEdit
    ? await Promise.all([activeSuppliers(session), categoryCounts(session)])
    : [[], []];
  const categories = [...new Set(cats.map((c) => c.category).filter((c): c is string => !!c))];
  const subcategories = [...new Set(cats.map((c) => c.subcategory).filter((c): c is string => !!c))];
  const available = part.on_hand - part.reserved;
  const margin = Number(part.unit_price) > 0
    ? ((Number(part.unit_price) - Number(part.unit_cost)) / Number(part.unit_price)) * 100
    : 0;
  const archivable = part.on_hand === 0 && part.reserved === 0 && part.on_order === 0;

  return (
    <div className="space-y-6">
      <LiveRefresh everyMs={10000} />

      <div>
        <Link href="/app/parts" className="text-sm text-steel hover:text-ink">← Inventory</Link>
        <h1 className="mt-1 text-2xl font-bold">{part.description}</h1>
        <p className="font-mono text-sm text-steel">
          {part.sku}{part.bin_location && ` · bin ${part.bin_location}`}{part.category && ` · ${part.category}${part.subcategory ? ` › ${part.subcategory}` : ""}`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="On hand" value={part.on_hand} />
        <Stat label="Reserved for jobs" value={part.reserved} />
        <Stat label="Available" value={available} tone={available <= 0 ? "bad" : part.reorder_point > 0 && available <= part.reorder_point ? "warn" : undefined} />
        <Stat label="On order" value={part.on_order} />
      </div>

      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div className={`${card} p-4`}>
          <div className="text-xs text-steel">Sell price</div>
          <div className="text-lg font-semibold tabular-nums">{money(part.unit_price)}</div>
          {showCost && (
            <div className="text-xs text-steel">
              cost {money(part.unit_cost)} · margin {margin.toFixed(0)}%
            </div>
          )}
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs text-steel">Reorder point</div>
          <div className="text-lg font-semibold tabular-nums">{part.reorder_point || "—"}</div>
          <div className="text-xs text-steel">
            {part.reorder_qty > 0 ? `order ${part.reorder_qty} at a time` : "no standard order quantity"}
          </div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-xs text-steel">Value on hand (at cost)</div>
          <div className="text-lg font-semibold tabular-nums">
            {showCost ? money(part.on_hand * Number(part.unit_cost)) : "—"}
          </div>
        </div>
      </div>

      {(holds.length > 0 || onOrder.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {holds.length > 0 && (
            <section className={`${card} overflow-hidden`}>
              <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Held by open jobs</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {holds.map((h) => (
                  <li key={h.work_order_id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>
                      <Link href={`/app/orders/${h.work_order_id}`} className="font-medium hover:underline">
                        #{h.number}
                      </Link>{" "}
                      <span className="text-steel">{h.customer}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={h.status} />
                      {h.qty_reserved > 0 && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">reserved {h.qty_reserved}</span>
                      )}
                      {h.qty_backordered > 0 && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">waiting {h.qty_backordered}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {onOrder.length > 0 && (
            <section className={`${card} overflow-hidden`}>
              <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">On order</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {onOrder.map((o) => (
                  <li key={o.po_id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>
                      <Link href={`/app/parts/orders/${o.po_id}`} className="font-medium hover:underline">PO #{o.number}</Link>{" "}
                      <span className="text-steel">{o.supplier}</span>
                    </span>
                    <span className="text-steel">
                      {o.outstanding} due{o.expected_at && ` ${dateOnly(o.expected_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${card} p-5`}>
            <h2 className="font-semibold">Count the shelf</h2>
            <p className="mb-3 text-xs text-steel">
              Enter what is actually there. Grip works out the difference and logs it.
            </p>
            <ActionForm action={countStock} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="part_id" value={part.id} />
              <div>
                <label className={label} htmlFor="counted">Counted</label>
                <input id="counted" name="counted" required inputMode="numeric" className={`${input} w-24`} />
              </div>
              <div className="min-w-40 flex-1">
                <label className={label} htmlFor="note">Note (optional)</label>
                <input id="note" name="note" className={`${input} w-full`} />
              </div>
              <button className={btn}>Record count</button>
            </ActionForm>
          </section>

          <section className={`${card} p-5`}>
            <h2 className="font-semibold">Adjust stock</h2>
            <p className="mb-3 text-xs text-steel">
              For damage, shrinkage or found stock. Use a minus sign to remove.
            </p>
            <ActionForm action={adjustStock} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="part_id" value={part.id} />
              <div>
                <label className={label} htmlFor="delta">Change</label>
                <input id="delta" name="delta" required inputMode="numeric" placeholder="-2" className={`${input} w-24`} />
              </div>
              <div className="min-w-40 flex-1">
                <label className={label} htmlFor="reason">Reason</label>
                <input id="reason" name="reason" required placeholder="e.g. damaged in storage" className={`${input} w-full`} />
              </div>
              <button className={btn}>Adjust</button>
            </ActionForm>
          </section>
        </div>
      )}

      <section className={`${card} overflow-x-auto`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Stock history</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">When</th>
              <th className="px-3 py-2">Movement</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-5 py-2">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => {
              const link = refLink(m.ref_type, m.ref_id);
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-5 py-2 text-xs text-steel">{dateTime(m.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${KIND_STYLE[m.kind] ?? "bg-slate-100"}`}>
                      {m.kind}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${m.delta > 0 ? "text-emerald-700" : ""}`}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </td>
                  <td className="px-3 py-2 text-steel">
                    {m.note}
                    {link && (
                      <Link href={link.href} className="ml-1 underline hover:text-ink">{link.label}</Link>
                    )}
                  </td>
                  <td className="px-5 py-2 text-xs text-steel">{m.who}</td>
                </tr>
              );
            })}
            {movements.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-6 text-center text-steel">No movements yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {canEdit && (
        <details className={`${card} p-5`}>
          <summary className="cursor-pointer text-sm font-semibold">Edit part details</summary>
          <ActionForm action={updatePart} className="mt-4 space-y-4" keepAfterSuccess>
            <input type="hidden" name="id" value={part.id} />
            <PartFields defaults={part} suppliers={suppliers} categories={categories} subcategories={subcategories} />
            <div className="flex items-center gap-3">
              <button className={btn}>Save changes</button>
            </div>
          </ActionForm>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <ActionForm action={archivePart} className="flex items-center gap-3">
              <input type="hidden" name="id" value={part.id} />
              <button className={btnDanger} disabled={!archivable}>Archive part</button>
              <span className="text-xs text-steel">
                {archivable
                  ? "Hides it from searches. History is kept."
                  : "Only available when nothing is on hand, reserved or on order."}
              </span>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" }) {
  return (
    <div className={`${card} p-4`}>
      <div className={`text-3xl font-bold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-steel">{label}</div>
    </div>
  );
}
