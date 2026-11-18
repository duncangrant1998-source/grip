import Link from "next/link";
import { ClickRow } from "@/components/ClickRow";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { activeSuppliers, listPurchaseOrders } from "@/lib/parts-queries";
import { listTaxRates } from "@/lib/queries";
import { dateOnly, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { PoBadge } from "@/components/PoBadge";
import { createPurchaseOrder } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireDepartment("parts");
  const sp = await searchParams;
  const scope = (TABS.find((t) => t.key === sp.scope)?.key ?? "open") as "open" | "closed" | "all";
  const canManage = can(session.role, "purchaseOrders.manage");

  const [orders, suppliers, taxRates] = await Promise.all([
    listPurchaseOrders(session, scope),
    canManage ? activeSuppliers(session) : Promise.resolve([]),
    canManage ? listTaxRates(session) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Purchase orders</h1>

      <div className="flex gap-1 self-start rounded-lg bg-slate-100 p-1 text-sm w-fit">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/parts/orders?scope=${t.key}`}
            className={`rounded-md px-3 py-1.5 font-medium ${scope === t.key ? "bg-white shadow-sm" : "text-steel hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">PO</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-3 py-3 text-right">Lines</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Expected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <ClickRow key={o.id} href={`/app/parts/orders/${o.id}`}>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/app/parts/orders/${o.id}`} className="hover:underline">#{o.number}</Link>
                </td>
                <td className="px-4 py-3">{o.supplier_name}</td>
                <td className="px-4 py-3"><PoBadge status={o.status} /></td>
                <td className="px-3 py-3 text-right tabular-nums">{o.lines}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(o.total)}</td>
                <td className="px-4 py-3 text-right text-steel">{o.expected_at ? dateOnly(o.expected_at) : ""}</td>
              </ClickRow>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-steel">No purchase orders here.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <section className={`${card} p-5`}>
          <h2 className="mb-3 text-sm font-semibold">New purchase order</h2>
          {suppliers.length === 0 ? (
            <p className="text-sm text-steel">
              Add a supplier first on the <Link href="/app/parts/suppliers" className="font-semibold underline">Suppliers</Link> tab.
            </p>
          ) : (
            <ActionForm action={createPurchaseOrder} className="grid items-end gap-3 sm:grid-cols-12" keepAfterSuccess>
              <div className="sm:col-span-4">
                <label className={label} htmlFor="po-sup">Supplier</label>
                <select id="po-sup" name="supplier_id" required className={`${input} w-full`}>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className={label} htmlFor="po-exp">Expected (optional)</label>
                <input id="po-exp" type="date" name="expected_at" className={`${input} w-full`} />
              </div>
              <div className="sm:col-span-3">
                <label className={label} htmlFor="po-tax">Tax</label>
                <select id="po-tax" name="tax_rate_id" className={`${input} w-full`}>
                  <option value="">No tax</option>
                  {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><button className={`${btn} w-full`}>Start order</button></div>
            </ActionForm>
          )}
        </section>
      )}
    </div>
  );
}
