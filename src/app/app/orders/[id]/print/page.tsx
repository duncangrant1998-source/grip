import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, inShop } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOrder } from "@/lib/queries";
import { EXEMPT_REASON_LABELS, bpsToPercent, date, hours, money } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/**
 * The customer-facing document. It is a quote until the job is invoiced, and an
 * invoice after. Deliberately shows no part cost, no actual hours and no
 * internal notes — only what the customer is charged.
 */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!can(session.role, "workorders.view", session.extraRoles)) redirect("/app?denied=orders");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getOrder(session, id);
  if (!data) notFound();
  const { order, labour, parts, taxes } = data;

  const [shop] = await inShop(session, (tx) => tx<
    { legal_name: string | null; address_line1: string | null; city: string | null;
      region: string | null; postal_code: string | null; phone: string | null;
      email: string | null; logo_url: string | null; invoice_footer: string | null;
      hst_number: string | null; name: string }[]
  >`SELECT s.legal_name, s.address_line1, s.city, s.region, s.postal_code, s.phone,
           s.email, s.logo_url, s.invoice_footer, s.hst_number, t.name
    FROM grip.tenants t LEFT JOIN grip.tenant_settings s ON s.tenant_id = t.id
    WHERE t.id = ${session.tenantId}`);

  const isInvoice = ["invoiced", "paid"].includes(order.status);
  const docTitle = isInvoice ? "Invoice" : "Quote";
  const docDate = order.invoiced_at ?? order.created_at;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/app/orders/${order.id}`} className="text-sm text-steel hover:text-ink">
          ← Back to work order
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-10 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div>
            {shop?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shop.logo_url} alt="" className="mb-2 h-12" />
            )}
            <h1 className="text-xl font-bold">{shop?.legal_name ?? shop?.name}</h1>
            <p className="text-sm text-steel">
              {[shop?.address_line1, [shop?.city, shop?.region].filter(Boolean).join(", "), shop?.postal_code]
                .filter(Boolean).join(" · ")}
            </p>
            <p className="text-sm text-steel">{[shop?.phone, shop?.email].filter(Boolean).join(" · ")}</p>
            {shop?.hst_number && <p className="text-sm text-steel">HST {shop.hst_number}</p>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold uppercase tracking-wide">{docTitle}</div>
            <div className="text-sm text-steel">#{order.number}</div>
            <div className="text-sm text-steel">{date(docDate)}</div>
            {order.status === "paid" && (
              <div className="mt-1 inline-block rounded border border-emerald-600 px-2 py-0.5 text-xs font-bold uppercase text-emerald-700">
                Paid
              </div>
            )}
            {order.status === "cancelled" && (
              <div className="mt-1 inline-block rounded border border-red-600 px-2 py-0.5 text-xs font-bold uppercase text-red-700">
                Cancelled
              </div>
            )}
          </div>
        </header>

        <section className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-steel">Customer</div>
            <div className="font-medium">{order.customer_name}</div>
            {order.customer_phone && <div className="text-steel">{order.customer_phone}</div>}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-steel">Vehicle</div>
            <div className="font-medium">{order.vehicle}</div>
            <div className="text-steel">
              {[order.plate && `Plate ${order.plate}`, order.mileage_in != null && `${order.mileage_in.toLocaleString()} km`]
                .filter(Boolean).join(" · ")}
            </div>
            {order.vin && <div className="font-mono text-xs text-steel">VIN {order.vin}</div>}
          </div>
        </section>

        {order.concern && (
          <p className="mt-6 text-sm"><span className="font-semibold">Concern: </span>{order.concern}</p>
        )}

        {labour.length > 0 && (
          <table className="mt-8 w-full text-sm">
            <thead className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="py-2">Labour</th>
                <th className="py-2 text-right">Hours</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {labour.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-right tabular-nums">{hours(l.billed_hours)}</td>
                  <td className="py-2 text-right tabular-nums">{money(l.rate)}</td>
                  <td className="py-2 text-right tabular-nums">{money(Number(l.billed_hours) * Number(l.rate))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {parts.length > 0 && (
          <table className="mt-6 w-full text-sm">
            <thead className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="py-2">Parts</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parts.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">
                    {p.description} <span className="font-mono text-xs text-steel">{p.sku}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.qty}</td>
                  <td className="py-2 text-right tabular-nums">{money(p.unit_price)}</td>
                  <td className="py-2 text-right tabular-nums">{money(p.qty * Number(p.unit_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {order.notes && (
          <section className="mt-6 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-steel">Notes</div>
            <p className="mt-1 whitespace-pre-wrap">{order.notes}</p>
          </section>
        )}

        <section className="ml-auto mt-8 max-w-xs space-y-1 text-sm">
          <Line label="Labour" value={money(order.labour_subtotal)} />
          <Line label="Parts" value={money(order.parts_subtotal)} />
          <Line label="Subtotal" value={money(order.subtotal)} bold />
          {taxes.map((t) => (
            <Line key={t.component_name} label={`${t.component_name} (${bpsToPercent(t.rate_bps)})`} value={money(t.amount)} />
          ))}
          {taxes.length === 0 && order.exempt_reason && <Line label="HST" value="Exempt" />}
          <div className="border-t border-slate-300 pt-2">
            <Line label={isInvoice ? "Total due" : "Estimated total"} value={money(order.total)} bold large />
          </div>
        </section>

        {order.exempt_reason && (
          <p className="mt-6 text-xs text-steel">
            <strong>No HST charged.</strong>{" "}
            {EXEMPT_REASON_LABELS[order.exempt_reason] ?? order.exempt_reason}
            {order.exempt_reference && ` · ${order.exempt_reference}`}
          </p>
        )}

        {!isInvoice && (
          <p className="mt-8 text-xs text-steel">
            This is a quote, not a bill. Final amounts may differ if the scope of work changes.
          </p>
        )}
        {shop?.invoice_footer && (
          <p className="mt-8 border-t border-slate-200 pt-4 text-xs text-steel">{shop.invoice_footer}</p>
        )}
      </article>
    </div>
  );
}

function Line({ label, value, bold, large }: { label: string; value: string; bold?: boolean; large?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${large ? "text-lg" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
