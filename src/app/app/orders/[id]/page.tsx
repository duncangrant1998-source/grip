import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can, canTransition, type WorkOrderStatus } from "@/lib/permissions";
import { getOrder, listTaxRates, listTechnicians, searchParts } from "@/lib/queries";
import { getSettings, orderJobTime } from "@/lib/admin-queries";
import { resolvePartSearch } from "@/lib/parts-queries";
import {
  EXEMPT_REASON_LABELS, MODE_LABELS, bpsToPercent, dateTime, isDetailsEditable, isEditable,
  isLabourEditable, money,
} from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { formatDuration } from "@/lib/dates";
import { TaxToggle } from "@/components/TaxToggle";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ExemptionFields } from "@/components/ExemptionFields";
import { StatusBadge } from "@/components/StatusBadge";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import {
  addPart, removePart, setExemption, setLabourMode, setPartLineTaxable, setTax, transition,
} from "../actions";
import { describeAudit } from "./audit";
import { DetailsEditor, NotesBox } from "./AutoSave";
import { CustomerPanel } from "./CustomerPanel";
import { AddLabourForm, LabourRow } from "./LabourEditor";

export const dynamic = "force-dynamic";

const NEXT_STEP: Record<string, { to: WorkOrderStatus; label: string } | undefined> = {
  quote: { to: "approved", label: "Approve quote" },
  approved: { to: "in_progress", label: "Start work" },
  in_progress: { to: "completed", label: "Complete job" },
  completed: { to: "invoiced", label: "Create invoice" },
  invoiced: { to: "paid", label: "Mark paid" },
};

export default async function WorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ partq?: string; panel?: string; cq?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "workorders.view")) redirect("/app?denied=orders");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { partq = "", panel, cq = "" } = await searchParams;

  const data = await getOrder(session, id);
  if (!data) notFound();
  const { order, labour, parts, taxes, audit } = data;

  const editable = isEditable(order.status);
  // Parts stop being editable once the job is completed (completing uses them up);
  // labour stays open until the order is invoiced, because hours get corrected then.
  const mayLabour = isLabourEditable(order.status) && can(session.role, "workorders.addLabour");
  // Notes are text for the customer: always open to whoever may edit labour.
  const mayNotes = order.status !== "cancelled" && can(session.role, "workorders.addLabour");
  const mayDetails = isDetailsEditable(order.status) && can(session.role, "workorders.addLabour");
  const mayChangeCustomer = isDetailsEditable(order.status) && can(session.role, "workorders.create");
  const mayPart = editable && can(session.role, "workorders.addPart");
  const mayOptions = can(session.role, "workorders.invoice") &&
    !["invoiced", "paid", "cancelled"].includes(order.status);
  const showCost = can(session.role, "parts.viewCost");
  const isTech = session.role === "technician";
  const flat = order.labour_billing_mode === "flat_rate";
  const jobTime = await orderJobTime(session, order.id);

  // A VIN typed into the part search finds parts for that vehicle.
  const partSearch = await resolvePartSearch(partq.trim());
  const [taxRates, techs, hits, shop] = await Promise.all([
    mayOptions ? listTaxRates(session) : Promise.resolve([]),
    mayLabour && !isTech ? listTechnicians(session) : Promise.resolve([]),
    mayPart && partq.trim() ? searchParts(session, partq.trim(), partSearch.vehicle) : Promise.resolve([]),
    getSettings(session),
  ]);
  const shopRate = Number(shop.default_labour_rate).toFixed(2);
  const provenance = (l: (typeof labour)[number]) =>
    l.edited_by_id && l.edited_by_id !== l.added_by_id
      ? { label: "Edited by" as const, name: l.edited_by, at: dateTime(l.edited_at ?? l.created_at) }
      : { label: "Added by" as const, name: l.added_by, at: dateTime(l.created_at) };

  const next = NEXT_STEP[order.status];
  const mayAdvance = next && canTransition(session.role, next.to);
  const mayCancel = ["quote", "approved", "in_progress"].includes(order.status) &&
    canTransition(session.role, "cancelled");
  const hasBackorder = parts.some((p) => p.qty_backordered > 0);

  return (
    <div className="space-y-6">
      <LiveRefresh />

      {/* Header ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/orders" className="text-sm text-steel hover:text-ink">← Work orders</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">Work order #{order.number}</h1>
            <StatusBadge status={order.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-1 text-sm">
            <div>
              {can(session.role, "customers.view") ? (
                <Link href={`/app/customers/${order.customer_id}`} className="text-base font-semibold hover:underline">
                  {order.customer_name}
                </Link>
              ) : (
                <span className="text-base font-semibold">{order.customer_name}</span>
              )}
              <div className="text-steel">
                {[order.customer_phone, order.customer_email].filter(Boolean).join(" · ") || "No phone or email on file"}
              </div>
            </div>
            <div>
              <div className="font-medium">
                {order.vehicle}{order.plate && <span className="font-normal text-steel"> · {order.plate}</span>}
              </div>
              {order.vin && <div className="font-mono text-xs text-steel">VIN {order.vin}</div>}
            </div>
            {mayChangeCustomer && (
              <Link
                href={panel === "customer" ? `/app/orders/${order.id}` : `/app/orders/${order.id}?panel=customer`}
                className={btnGhost}
              >
                {panel === "customer" ? "Close" : "Change customer / vehicle"}
              </Link>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/orders/${order.id}/print`} className={btnGhost}>
            {["invoiced", "paid"].includes(order.status) ? "View invoice" : "View / print quote"}
          </Link>
          {mayCancel && (
            <ActionForm action={transition}>
              <input type="hidden" name="work_order_id" value={order.id} />
              <input type="hidden" name="to" value="cancelled" />
              <button className={btnDanger}>Cancel order</button>
            </ActionForm>
          )}
          {mayAdvance && next && (
            <ActionForm action={transition}>
              <input type="hidden" name="work_order_id" value={order.id} />
              <input type="hidden" name="to" value={next.to} />
              <button className={btn}>{next.label}</button>
            </ActionForm>
          )}
        </div>
      </div>

      {hasBackorder && editable && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some parts on this order are on backorder. They are billed in full but only the
          in-stock quantity is reserved.
        </p>
      )}

      {mayChangeCustomer && panel === "customer" && (
        <CustomerPanel
          session={session} orderId={order.id} customerId={order.customer_id}
          vehicleId={order.vehicle_id} search={cq}
        />
      )}

      <DetailsEditor
        orderId={order.id} concern={order.concern} mileage={order.mileage_in} editable={mayDetails}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="min-w-0 space-y-6">
      {/* Labour ---------------------------------------------------------------- */}
      <section className={`${card} overflow-x-auto`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">Labour</h2>
          <span className="text-xs text-steel">
            Default: {MODE_LABELS[order.labour_billing_mode]}
            {mayLabour && " · click any box to edit; it saves when you click away"}
          </span>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Work</th>
              <th className="px-3 py-2 text-right">Billed hrs</th>
              <th className="px-3 py-2 text-right">Actual hrs</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-5 py-2">Added / edited by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {labour.map((l) => (
              <LabourRow
                key={l.id}
                orderId={order.id}
                line={{
                  id: l.id, description: l.description, billed_hours: l.billed_hours,
                  actual_hours: l.actual_hours, rate: l.rate,
                  billing_mode: l.billing_mode as "flat_rate" | "straight_time",
                  tech_id: l.tech_id, is_taxable: l.is_taxable,
                }}
                provenance={provenance(l)}
                editable={mayLabour}
                isTech={isTech}
                techs={techs}
              />
            ))}
            {labour.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-steel">No labour yet.</td></tr>
            )}
          </tbody>
        </table>

        {mayLabour && (
          <AddLabourForm
            orderId={order.id}
            defaultMode={order.labour_billing_mode}
            isTech={isTech}
            techs={techs}
            shopRate={shopRate}
          />
        )}
      </section>

      {/* Notes for the customer --------------------------------------------------- */}
      <section className={`${card} p-5`}>
        <NotesBox orderId={order.id} value={order.notes} editable={mayNotes} />
      </section>

      {/* Parts ---------------------------------------------------------------- */}
      <section id="parts" className={`${card} scroll-mt-4 overflow-x-auto`}>
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">Parts</h2>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Part</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              {showCost && <th className="px-3 py-2 text-right">Cost</th>}
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-5 py-2">Added by</th>
              {mayPart && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {parts.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-5 py-3">
                  <div className="font-medium">{p.description}</div>
                  <div className="font-mono text-xs text-steel">{p.sku}</div>
                  <div className="mt-1">
                    <TaxToggle
                      action={setPartLineTaxable}
                      fields={{ work_order_id: order.id, line_id: p.id }}
                      checked={p.is_taxable}
                      disabled={!mayPart}
                      label="Taxable"
                    />
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {p.qty}
                  <div className="mt-0.5 space-x-1 text-[11px]">
                    {p.qty_consumed > 0 && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">used {p.qty_consumed}</span>}
                    {p.qty_reserved > 0 && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">reserved {p.qty_reserved}</span>}
                    {p.qty_backordered > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">backordered {p.qty_backordered}</span>}
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-steel">{money(p.unit_price)}</td>
                {showCost && <td className="px-3 py-3 text-right tabular-nums text-steel">{money(p.unit_cost)}</td>}
                <td className="px-3 py-3 text-right font-medium tabular-nums">{money(p.qty * Number(p.unit_price))}</td>
                <td className="px-5 py-3 text-xs text-steel">
                  {p.edited_by_id && p.edited_by_id !== p.added_by_id
                    ? <>Edited by {p.edited_by}<div>{dateTime(p.edited_at ?? p.created_at)}</div></>
                    : <>{p.added_by}<div>{dateTime(p.created_at)}</div></>}
                </td>
                {mayPart && (
                  <td className="px-3 py-3 text-right">
                    {p.qty_consumed === 0 && (
                      <ActionForm action={removePart} className="inline-block">
                        <input type="hidden" name="work_order_id" value={order.id} />
                        <input type="hidden" name="line_id" value={p.id} />
                        <button className={btnDanger} title="Delete this part from the order and return it to stock">Delete</button>
                      </ActionForm>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {parts.length === 0 && (
              <tr><td colSpan={(showCost ? 6 : 5) + (mayPart ? 1 : 0)} className="px-5 py-6 text-center text-steel">No parts yet.</td></tr>
            )}
          </tbody>
        </table>

        {mayPart && (
          <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
            <form className="flex gap-2">
              <input
                name="partq" defaultValue={partq} aria-label="Search parts"
                placeholder="Find a part by SKU or description…" className={`${input} flex-1`}
              />
              <button className={btn}>Find</button>
            </form>

            {partSearch.vehicle && (
              <p className="text-sm text-emerald-800">
                Parts for {partSearch.vehicle.label} (from the VIN), matched on their &ldquo;Fits&rdquo; list or description.
              </p>
            )}
            {partSearch.vinError && <p className="text-sm text-red-700">{partSearch.vinError}</p>}
            {partq.trim() && hits.length === 0 && (
              <p className="text-sm text-steel">No parts match &ldquo;{partq}&rdquo;.</p>
            )}

            {hits.length > 0 && (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {hits.map((h) => (
                  <ActionForm key={h.id} action={addPart} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="hidden" name="work_order_id" value={order.id} />
                    <input type="hidden" name="part_id" value={h.id} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{h.description}</div>
                      <div className="text-xs text-steel">
                        <span className="font-mono">{h.sku}</span>
                        {h.bin_location && ` · bin ${h.bin_location}`}
                        {" · "}{money(h.unit_price)}
                        {showCost && h.unit_cost != null && ` · cost ${money(h.unit_cost)}`}
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${h.available > 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {h.available} available
                    </span>
                    <input name="qty" defaultValue={1} inputMode="numeric" aria-label="Quantity" className={`${input} w-16`} />
                    <label className="flex items-center gap-1 text-xs text-steel">
                      <input type="checkbox" name="allow_backorder" /> backorder
                    </label>
                    <button className={btn}>Add</button>
                  </ActionForm>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-4">
      {/* Options: tax and labour mode ---------------------------------------- */}
      {mayOptions && (
        <div className={`${card} space-y-4 p-4`}>
          <ActionForm action={setTax} className="flex items-end gap-2" keepAfterSuccess>
            <input type="hidden" name="work_order_id" value={order.id} />
            <div className="flex-1">
              <label className={label} htmlFor="tax_rate_id">Tax</label>
              <select id="tax_rate_id" name="tax_rate_id" defaultValue={order.tax_rate_id ?? ""} className={`${input} w-full`}>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {t.components}</option>
                ))}
              </select>
            </div>
            <button className={btnGhost}>Apply</button>
          </ActionForm>

          {/* No HST means the shop has to be able to say why. */}
          {order.is_exempt && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
                Exempt — why?
              </div>
              <ActionForm action={setExemption} className="space-y-2" keepAfterSuccess>
                <input type="hidden" name="work_order_id" value={order.id} />
                <ExemptionFields reason={order.exempt_reason} reference={order.exempt_reference} compact />
                <button className={btnGhost}>Save reason</button>
              </ActionForm>
              {!order.exempt_reason && (
                <p className="mt-2 text-xs text-amber-900">
                  This order can&apos;t be invoiced until a reason is recorded.
                </p>
              )}
            </div>
          )}

          {mayLabour && (
            <ActionForm action={setLabourMode} className="flex items-end gap-2" keepAfterSuccess>
              <input type="hidden" name="work_order_id" value={order.id} />
              <div className="flex-1">
                <label className={label} htmlFor="mode">New labour lines are billed as</label>
                <select id="mode" name="mode" defaultValue={order.labour_billing_mode} className={`${input} w-full`}>
                  {Object.entries(MODE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <button className={btnGhost}>Apply</button>
            </ActionForm>
          )}
        </div>
      )}

      {/* Totals --------------------------------------------------------------- */}
      <section className={`${card} p-5 text-sm`}>
        <Row label="Labour" value={money(order.labour_subtotal)} />
        <Row label="Parts" value={money(order.parts_subtotal)} />
        <Row label="Subtotal" value={money(order.subtotal)} strong />
        {taxes.map((t) => (
          <Row key={t.component_name} label={`${t.component_name} ${bpsToPercent(t.rate_bps)}`} value={money(t.amount)} muted />
        ))}
        {taxes.length === 0 && (
          <Row
            label={order.exempt_reason
              ? `No HST — ${EXEMPT_REASON_LABELS[order.exempt_reason] ?? order.exempt_reason}`
              : "No HST — reason not recorded"}
            value={money(0)} muted
          />
        )}
        <div className="mt-2 border-t border-slate-200 pt-2">
          <Row label="Total" value={money(order.total)} strong large />
        </div>
      </section>

      {/* Time logged on this job ------------------------------------------------ */}
      {jobTime.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Time on this job</h2>
          <ul className={`${card} divide-y divide-slate-100 text-sm`}>
            {jobTime.map((t) => (
              <li key={t.employee_id} className="flex items-center justify-between px-4 py-2.5">
                <span>
                  {t.full_name}
                  {t.on_now && <span className="ml-2 text-xs font-medium text-emerald-700">on it now</span>}
                </span>
                <span className="tabular-nums text-steel">{formatDuration(t.minutes)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between px-4 py-2.5 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatDuration(jobTime.reduce((n, t) => n + t.minutes, 0))}</span>
            </li>
          </ul>
        </section>
      )}

      {/* Activity ------------------------------------------------------------- */}
      <section>
        <h2 className="mb-3 font-semibold">Activity</h2>
        <ol className={`${card} divide-y divide-slate-100 text-sm`}>
          {audit.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
              <span>
                <span className="font-medium">{a.actor ?? "System"}</span>{" "}
                <span className="text-steel">{describeAudit(a.action, a.diff)}</span>
              </span>
              <span className="shrink-0 text-xs text-steel">{dateTime(a.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>
        </aside>
      </div>
    </div>
  );
}

function Row({
  label, value, strong, muted, large,
}: { label: string; value: string; strong?: boolean; muted?: boolean; large?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${muted ? "text-steel" : ""} ${strong ? "font-semibold" : ""} ${large ? "text-lg" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
