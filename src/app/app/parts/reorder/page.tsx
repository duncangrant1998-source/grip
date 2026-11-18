import Link from "next/link";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { reorderSuggestions } from "@/lib/parts-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, card } from "@/components/ui";
import { createReorder } from "../orders/actions";

export const dynamic = "force-dynamic";

export default async function ReorderPage() {
  const session = await requireDepartment("parts");
  const groups = await reorderSuggestions(session);
  const canOrder = can(session.role, "purchaseOrders.manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reorder</h1>
        <p className="text-sm text-steel">
          Parts at or below their reorder point. Stock already on order is counted, so a part
          you have ordered will not show up again.
        </p>
      </div>

      {groups.length === 0 && (
        <div className={`${card} p-8 text-center text-sm text-steel`}>
          Nothing needs reordering. Set a reorder point on a part to track it here.
        </div>
      )}

      {groups.map((g) => (
        <section key={g.supplier_id ?? "none"} className={`${card} overflow-x-auto`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold">{g.supplier_name ?? "No supplier assigned"}</h2>
            {g.supplier_id && canOrder ? (
              <ActionForm action={createReorder}>
                <input type="hidden" name="supplier_id" value={g.supplier_id} />
                <button className={btn}>Create purchase order</button>
              </ActionForm>
            ) : (
              <span className="text-xs text-steel">Assign a supplier to these parts to order them here.</span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Part</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">On order</th>
                <th className="px-3 py-2 text-right">Reorder at</th>
                <th className="px-5 py-2 text-right">Suggested order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {g.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-5 py-2.5">
                    <Link href={`/app/parts/${i.id}`} className="font-medium hover:underline">{i.description}</Link>
                    <div className="font-mono text-xs text-steel">{i.sku}</div>
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${i.available <= 0 ? "font-semibold text-red-700" : ""}`}>{i.available}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-steel">{i.on_order || ""}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-steel">{i.reorder_point}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{i.suggested}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
