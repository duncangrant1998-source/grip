import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPurchaseOrder } from "@/lib/parts-queries";
import { listTaxRates, searchParts } from "@/lib/queries";
import { dateOnly, dateTime, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PoBadge } from "@/components/PoBadge";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { describePartsAudit } from "../../audit";
import {
  addPoLine, cancelPo, placePo, receiveDelivery, removePoLine, setPoOptions, updatePoLine,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ partq?: string }>;
}) {
  const session = await requireDepartment("parts");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { partq = "" } = await searchParams;

  const data = await getPurchaseOrder(session, id);
  if (!data) notFound();
  const { po, lines, audit } = data;

  const canManage = can(session.role, "purchaseOrders.manage");
  const isDraft = po.status === "draft";
  const mayEdit = canManage && isDraft;
  const mayReceive = canManage && ["ordered", "partial"].includes(po.status);
  const mayCancel = canManage && ["draft", "ordered", "partial"].includes(po.status);
  const anyReceived = lines.some((l) => l.qty_received > 0);
  const outstanding = lines.filter((l) => l.qty_ordered > l.qty_received);

  const [taxRates, hits] = await Promise.all([
    canManage && ["draft", "ordered"].includes(po.status) ? listTaxRates(session) : Promise.resolve([]),
    mayEdit && partq.trim() ? searchParts(session, partq.trim()) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <LiveRefresh everyMs={10000} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/parts/orders" className="text-sm text-steel hover:text-ink">← Purchase orders</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">Purchase order #{po.number}</h1>
            <PoBadge status={po.status} />
          </div>
          <p className="mt-1 text-sm">
            <span className="font-medium">{po.supplier_name}</span>
            <span className="text-steel">
              {po.supplier_phone && ` · ${po.supplier_phone}`}
              {po.expected_at && ` · expected ${dateOnly(po.expected_at)}`}
              {po.created_by && ` · started by ${po.created_by}`}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {mayCancel && (
            <ActionForm action={cancelPo}>
              <input type="hidden" name="po_id" value={po.id} />
              <button className={btnDanger}>{anyReceived ? "Close short" : "Cancel order"}</button>
            </ActionForm>
          )}
          {mayEdit && (
            <ActionForm action={placePo}>
              <input type="hidden" name="po_id" value={po.id} />
              <button className={btn} disabled={lines.length === 0}>Place order</button>
            </ActionForm>
          )}
        </div>
      </div>

      {isDraft && (
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">
          This is a draft. Nothing counts as &ldquo;on order&rdquo; until you place it.
        </p>
      )}

      {canManage && ["draft", "ordered"].includes(po.status) && (
        <ActionForm action={setPoOptions} className={`${card} grid items-end gap-3 p-4 sm:grid-cols-12`} keepAfterSuccess>
          <input type="hidden" name="po_id" value={po.id} />
          <div className="sm:col-span-4">
            <label className={label} htmlFor="exp">Expected delivery</label>
            <input id="exp" type="date" name="expected_at"
              defaultValue={po.expected_at ? new Date(po.expected_at).toISOString().slice(0, 10) : ""}
              className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-6">
            <label className={label} htmlFor="tax">Tax on this order</label>
            <select id="tax" name="tax_rate_id" defaultValue={po.tax_rate_id ?? ""} className={`${input} w-full`}>
              <option value="">No tax</option>
              {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.components}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><button className={`${btnGhost} w-full`}>Apply</button></div>
        </ActionForm>
      )}

      {/* Lines ----------------------------------------------------------------- */}
      <section className={`${card} overflow-x-auto`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Lines</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Part</th>
              <th className="px-3 py-2 text-right">On hand</th>
              <th className="px-3 py-2 text-right">Ordered</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-5 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-5 py-3">
                  <Link href={`/app/parts/${l.part_id}`} className="font-medium hover:underline">{l.description}</Link>
                  <div className="font-mono text-xs text-steel">{l.sku}{l.bin_location && ` · bin ${l.bin_location}`}</div>
                  {mayEdit && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <ActionForm action={updatePoLine} className="flex items-center gap-2" keepAfterSuccess>
                        <input type="hidden" name="po_id" value={po.id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <input name="qty" defaultValue={l.qty_ordered} inputMode="numeric" aria-label="Quantity" className={`${input} w-20`} />
                        <input name="unit_cost" defaultValue={l.unit_cost} inputMode="decimal" aria-label="Unit cost" className={`${input} w-24`} />
                        <button className={btnGhost}>Update</button>
                      </ActionForm>
                      <ActionForm action={removePoLine}>
                        <input type="hidden" name="po_id" value={po.id} />
                        <input type="hidden" name="line_id" value={l.id} />
                        <button className="text-xs text-red-700 hover:underline">Remove</button>
                      </ActionForm>
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-steel">{l.on_hand}</td>
                <td className="px-3 py-3 text-right tabular-nums">{l.qty_ordered}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${l.qty_received >= l.qty_ordered ? "text-emerald-700" : "text-steel"}`}>
                  {l.qty_received}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-steel">{money(l.unit_cost)}</td>
                <td className="px-5 py-3 text-right font-medium tabular-nums">{money(l.qty_ordered * Number(l.unit_cost))}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-steel">No lines yet.</td></tr>
            )}
          </tbody>
        </table>

        {mayEdit && (
          <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
            <form className="flex gap-2">
              <input name="partq" defaultValue={partq} aria-label="Search parts"
                placeholder="Find a part to add by SKU or description…" className={`${input} flex-1`} />
              <button className={btn}>Find</button>
            </form>
            {partq.trim() && hits.length === 0 && (
              <p className="text-sm text-steel">No parts match &ldquo;{partq}&rdquo;.</p>
            )}
            {hits.length > 0 && (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {hits.map((h) => (
                  <ActionForm key={h.id} action={addPoLine} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="hidden" name="po_id" value={po.id} />
                    <input type="hidden" name="part_id" value={h.id} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{h.description}</div>
                      <div className="text-xs text-steel">
                        <span className="font-mono">{h.sku}</span> · {h.on_hand} on hand · {h.available} available
                      </div>
                    </div>
                    <input name="qty" defaultValue={1} inputMode="numeric" aria-label="Quantity" className={`${input} w-16`} />
                    <input name="unit_cost" defaultValue={h.unit_cost} inputMode="decimal" aria-label="Unit cost" className={`${input} w-24`} />
                    <button className={btn}>Add</button>
                  </ActionForm>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Receiving ---------------------------------------------------------------- */}
      {mayReceive && outstanding.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Receive a delivery</h2>
              <p className="text-xs text-steel">
                Enter what actually arrived. Anything a job was waiting on is allocated to it automatically.
              </p>
            </div>
            <ActionForm action={receiveDelivery}>
              <input type="hidden" name="po_id" value={po.id} />
              {outstanding.map((l) => (
                <input key={l.id} type="hidden" name={`recv_${l.id}`} value={l.qty_ordered - l.qty_received} />
              ))}
              <button className={btnGhost}>Receive everything outstanding</button>
            </ActionForm>
          </div>

          <ActionForm action={receiveDelivery} className="space-y-3">
            <input type="hidden" name="po_id" value={po.id} />
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {outstanding.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{l.description}</span>{" "}
                    <span className="font-mono text-xs text-steel">{l.sku}</span>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-steel">
                    {l.qty_ordered - l.qty_received} outstanding — arrived:
                    <input name={`recv_${l.id}`} inputMode="numeric" className={`${input} w-20 text-sm text-ink`} />
                  </label>
                </div>
              ))}
            </div>
            <button className={btn}>Receive</button>
          </ActionForm>
        </section>
      )}

      <section className={`${card} ml-auto max-w-sm p-5 text-sm`}>
        <div className="flex justify-between py-0.5"><span>Subtotal</span><span className="tabular-nums">{money(po.subtotal)}</span></div>
        <div className="flex justify-between py-0.5 text-steel"><span>Tax</span><span className="tabular-nums">{money(po.tax_total)}</span></div>
        <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold">
          <span>Total</span><span className="tabular-nums">{money(po.total)}</span>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Activity</h2>
        <ol className={`${card} divide-y divide-slate-100 text-sm`}>
          {audit.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
              <span>
                <span className="font-medium">{a.actor ?? "System"}</span>{" "}
                <span className="text-steel">{describePartsAudit(a.action, a.diff)}</span>
              </span>
              <span className="shrink-0 text-xs text-steel">{dateTime(a.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
