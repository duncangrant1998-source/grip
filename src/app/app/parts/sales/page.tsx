import Link from "next/link";
import { ClickRow } from "@/components/ClickRow";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listCounterSales } from "@/lib/parts-queries";
import { dateTime, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { PoBadge } from "@/components/PoBadge";
import { btn, card, input, label } from "@/components/ui";
import { startSale } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "In progress" },
  { key: "done", label: "Finished" },
  { key: "all", label: "All" },
] as const;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireDepartment("parts");
  const sp = await searchParams;
  const scope = (TABS.find((t) => t.key === sp.scope)?.key ?? "all") as "open" | "done" | "all";
  const sales = await listCounterSales(session, scope);
  const canSell = can(session.role, "counterSales.create", session.extraRoles);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Counter sales</h1>
      <p className="-mt-3 text-sm text-steel">
        Parts sold over the counter without a work order. Stock leaves the shelf as each part is added.
      </p>

      {canSell && (
        <section className={`${card} p-5`}>
          <ActionForm action={startSale} className="flex flex-wrap items-end gap-3" keepAfterSuccess>
            <div className="min-w-56 flex-1">
              <label className={label} htmlFor="who">Customer (optional)</label>
              <input id="who" name="customer_name" placeholder="Walk-in" className={`${input} w-full`} />
            </div>
            <button className={btn}>Start a sale</button>
          </ActionForm>
        </section>
      )}

      <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/parts/sales?scope=${t.key}`}
            className={`rounded-md px-3 py-1.5 font-medium ${scope === t.key ? "bg-white shadow-sm" : "text-steel hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">Sale</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Sold by</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sales.map((s) => (
              <ClickRow key={s.id} href={`/app/parts/sales/${s.id}`}>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/app/parts/sales/${s.id}`} className="hover:underline">#{s.number}</Link>
                </td>
                <td className="px-4 py-3">{s.customer_name}</td>
                <td className="px-4 py-3"><PoBadge status={s.status} /></td>
                <td className="px-4 py-3 text-steel">{s.sold_by}</td>
                <td className="px-3 py-3 text-right tabular-nums">{money(s.total)}</td>
                <td className="px-4 py-3 text-right text-xs text-steel">{dateTime(s.created_at)}</td>
              </ClickRow>
            ))}
            {sales.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-steel">No sales here yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
