import Link from "next/link";
import type { PartsOrderRow } from "@/lib/parts-queries";
import { money } from "@/lib/format";
import { ClickRow } from "@/components/ClickRow";
import { StatusBadge } from "@/components/StatusBadge";
import { btnGhost, card } from "@/components/ui";

/**
 * The list behind both "Open work orders" and "Incoming work orders". A row
 * opens the order, which is where parts are added; the button goes straight to
 * the parts section of it.
 */
export function PartsOrdersList({
  rows, kind,
}: { rows: PartsOrderRow[]; kind: "open" | "incoming" }) {
  const incoming = kind === "incoming";

  return (
    <div className={`${card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
          <tr>
            <th className="px-4 py-3">Order</th>
            {incoming && <th className="px-4 py-3">Booked for</th>}
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">Vehicle</th>
            <th className="px-4 py-3">Concern</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Parts</th>
            <th className="px-4 py-3 text-right">Parts value</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((o) => (
            <ClickRow key={o.id} href={`/app/orders/${o.id}#parts`}>
              <td className="px-4 py-3 font-medium">
                <Link href={`/app/orders/${o.id}#parts`} className="hover:underline">#{o.number}</Link>
              </td>
              {incoming && (
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="font-medium">{o.appt_when}</div>
                  <div className="text-xs text-steel capitalize">{o.appt_status}</div>
                </td>
              )}
              <td className="px-4 py-3">{o.customer}</td>
              <td className="px-4 py-3 text-steel">
                {o.vehicle}{o.plate && <span className="block text-xs">{o.plate}</span>}
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-steel">{o.concern}</td>
              <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
              <td className="px-4 py-3">
                {o.part_lines === 0 ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-steel">none yet</span>
                ) : (
                  <span className="text-xs">
                    {o.part_lines} line{o.part_lines === 1 ? "" : "s"}
                    {o.backordered > 0 && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
                        {o.backordered} backordered
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{o.part_lines > 0 ? money(o.parts_value) : "—"}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/app/orders/${o.id}#parts`} className={btnGhost}>Add parts</Link>
              </td>
            </ClickRow>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={incoming ? 9 : 8} className="px-4 py-10 text-center text-steel">
                {incoming
                  ? "Nothing booked in yet. Appointments that haven't arrived appear here with their quote."
                  : "No vehicles in the shop right now."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
