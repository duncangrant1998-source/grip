import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCounterSale } from "@/lib/parts-queries";
import { listTaxRates, searchParts } from "@/lib/queries";
import { EXEMPT_REASON_LABELS, bpsToPercent, dateTime, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { TaxToggle } from "@/components/TaxToggle";
import { ExemptionFields } from "@/components/ExemptionFields";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PoBadge } from "@/components/PoBadge";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { SaleCustomerPanel } from "./SaleCustomerPanel";
import {
  addSaleLine, cancelSale, completeSale, removeSaleLine, setSaleExemption, setSaleLineTaxable, setSaleTax,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function SalePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ partq?: string; panel?: string; cq?: string }>;
}) {
  const session = await requireDepartment("parts");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { partq = "", panel, cq = "" } = await searchParams;

  const data = await getCounterSale(session, id);
  if (!data) notFound();
  const { sale, lines, taxes } = data;

  const isOpen = sale.status === "open";
  const maySell = isOpen && can(session.role, "counterSales.create");
  const showCost = can(session.role, "parts.viewCost");

  const [taxRates, hits] = await Promise.all([
    maySell ? listTaxRates(session) : Promise.resolve([]),
    maySell && partq.trim() ? searchParts(session, partq.trim()) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      {isOpen && <LiveRefresh everyMs={15000} />}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/parts/sales" className="text-sm text-steel hover:text-ink">← Counter sales</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">Counter sale #{sale.number}</h1>
            <PoBadge status={sale.status} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-steel">
            <span>
              <span className="font-medium text-ink">{sale.customer_name}</span>
              {sale.sold_by && ` · sold by ${sale.sold_by}`} · {dateTime(sale.created_at)}
            </span>
            {maySell && (
              <Link
                href={panel === "customer" ? `/app/parts/sales/${sale.id}` : `/app/parts/sales/${sale.id}?panel=customer`}
                className={btnGhost}
              >
                {panel === "customer" ? "Close" : "Change customer"}
              </Link>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {sale.status !== "cancelled" && lines.length > 0 && (
            <Link href={`/app/parts/sales/${sale.id}/print`} className={btnGhost}>
              {isOpen ? "Preview receipt" : "View receipt"}
            </Link>
          )}
          {maySell && (
            <ActionForm action={cancelSale}>
              <input type="hidden" name="sale_id" value={sale.id} />
              <button className={btnDanger}>Cancel sale</button>
            </ActionForm>
          )}
          {maySell && (
            <ActionForm action={completeSale}>
              <input type="hidden" name="sale_id" value={sale.id} />
              <button className={btn} disabled={lines.length === 0}>Complete sale</button>
            </ActionForm>
          )}
        </div>
      </div>

      {maySell && panel === "customer" && (
        <SaleCustomerPanel session={session} saleId={sale.id} currentName={sale.customer_name} search={cq} />
      )}

      {maySell && (
        <ActionForm action={setSaleTax} className={`${card} flex items-end gap-3 p-4`} keepAfterSuccess>
          <input type="hidden" name="sale_id" value={sale.id} />
          <div className="flex-1">
            <label className={label} htmlFor="stax">Tax</label>
            <select id="stax" name="tax_rate_id" defaultValue={sale.tax_rate_id ?? ""} className={`${input} w-full`}>
              {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.components}</option>)}
            </select>
          </div>
          <button className={btnGhost}>Apply</button>
        </ActionForm>
      )}

      {maySell && isOpen && sale.is_exempt && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
            Exempt — why?
          </div>
          <ActionForm action={setSaleExemption} className="flex flex-wrap items-end gap-3" keepAfterSuccess>
            <input type="hidden" name="sale_id" value={sale.id} />
            <div className="min-w-80 flex-1">
              <ExemptionFields reason={sale.exempt_reason} reference={sale.exempt_reference} />
            </div>
            <button className={btnGhost}>Save reason</button>
          </ActionForm>
          {!sale.exempt_reason && (
            <p className="mt-2 text-xs text-amber-900">
              This sale can&apos;t be completed until a reason is recorded.
            </p>
          )}
        </div>
      )}

      <section className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Part</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              {showCost && <th className="px-3 py-2 text-right">Cost</th>}
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-5 py-2">Added by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-5 py-3">
                  <div className="font-medium">{l.description}</div>
                  <div className="font-mono text-xs text-steel">{l.sku}</div>
                  <div className="mt-1">
                    <TaxToggle
                      action={setSaleLineTaxable}
                      fields={{ sale_id: sale.id, line_id: l.id }}
                      checked={l.is_taxable}
                      disabled={!maySell}
                      label="Taxable"
                    />
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{l.qty}</td>
                <td className="px-3 py-3 text-right tabular-nums text-steel">{money(l.unit_price)}</td>
                {showCost && <td className="px-3 py-3 text-right tabular-nums text-steel">{money(l.unit_cost)}</td>}
                <td className="px-3 py-3 text-right font-medium tabular-nums">{money(l.qty * Number(l.unit_price))}</td>
                <td className="px-5 py-3 text-xs text-steel">
                  {l.added_by}
                  {maySell && (
                    <ActionForm action={removeSaleLine} className="mt-1">
                      <input type="hidden" name="sale_id" value={sale.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <button className="text-red-700 hover:underline">Remove</button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={showCost ? 6 : 5} className="px-5 py-6 text-center text-steel">No parts on this sale yet.</td></tr>
            )}
          </tbody>
        </table>

        {maySell && (
          <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
            <form className="flex gap-2">
              <input name="partq" defaultValue={partq} autoFocus aria-label="Search parts"
                placeholder="Find a part by SKU or description…" className={`${input} flex-1`} />
              <button className={btn}>Find</button>
            </form>
            {partq.trim() && hits.length === 0 && (
              <p className="text-sm text-steel">No parts match &ldquo;{partq}&rdquo;.</p>
            )}
            {hits.length > 0 && (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {hits.map((h) => (
                  <ActionForm key={h.id} action={addSaleLine} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="hidden" name="sale_id" value={sale.id} />
                    <input type="hidden" name="part_id" value={h.id} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{h.description}</div>
                      <div className="text-xs text-steel">
                        <span className="font-mono">{h.sku}</span>
                        {h.bin_location && ` · bin ${h.bin_location}`} · {money(h.unit_price)}
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${h.available > 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {h.available} available
                    </span>
                    <input name="qty" defaultValue={1} inputMode="numeric" aria-label="Quantity" className={`${input} w-16`} />
                    <button className={btn} disabled={h.available <= 0}>Add</button>
                  </ActionForm>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className={`${card} ml-auto max-w-sm p-5 text-sm`}>
        <div className="flex justify-between py-0.5"><span>Subtotal</span><span className="tabular-nums">{money(sale.subtotal)}</span></div>
        {taxes.map((t) => (
          <div key={t.component_name} className="flex justify-between py-0.5 text-steel">
            <span>{t.component_name} {bpsToPercent(t.rate_bps)}</span>
            <span className="tabular-nums">{money(t.amount)}</span>
          </div>
        ))}
        {taxes.length === 0 && (
          <div className="flex justify-between py-0.5 text-steel"><span>Tax</span><span className="tabular-nums">{money(0)}</span></div>
        )}
        <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold">
          <span>Total</span><span className="tabular-nums">{money(sale.total)}</span>
        </div>
      </section>
    </div>
  );
}
