import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDepartment, inShop } from "@/lib/auth";
import { getCounterSale } from "@/lib/parts-queries";
import { EXEMPT_REASON_LABELS, bpsToPercent, dateTime, money } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** Customer-facing receipt. No cost, no internal notes. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDepartment("parts");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getCounterSale(session, id);
  if (!data) notFound();
  const { sale, lines, taxes } = data;

  const [shop] = await inShop(session, (tx) => tx<
    { legal_name: string | null; address_line1: string | null; city: string | null;
      region: string | null; postal_code: string | null; phone: string | null;
      invoice_footer: string | null; hst_number: string | null; name: string }[]
  >`SELECT s.legal_name, s.address_line1, s.city, s.region, s.postal_code, s.phone,
           s.invoice_footer, s.hst_number, t.name
    FROM grip.tenants t LEFT JOIN grip.tenant_settings s ON s.tenant_id = t.id
    WHERE t.id = ${session.tenantId}`);

  const done = sale.status === "completed";

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/app/parts/sales/${sale.id}`} className="text-sm text-steel hover:text-ink">← Back to sale</Link>
        <PrintButton />
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-8 text-sm shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="text-center">
          <h1 className="text-lg font-bold">{shop?.legal_name ?? shop?.name}</h1>
          <p className="text-xs text-steel">
            {[shop?.address_line1, [shop?.city, shop?.region].filter(Boolean).join(", "), shop?.postal_code]
              .filter(Boolean).join(" · ")}
          </p>
          {shop?.phone && <p className="text-xs text-steel">{shop.phone}</p>}
          {shop?.hst_number && <p className="text-xs text-steel">HST {shop.hst_number}</p>}
          <p className="mt-3 text-base font-bold uppercase tracking-wide">{done ? "Receipt" : "Sale (not yet complete)"}</p>
          <p className="text-xs text-steel">#{sale.number} · {dateTime(sale.completed_at ?? sale.created_at)}</p>
          {sale.customer_name && <p className="text-xs text-steel">{sale.customer_name}</p>}
        </header>

        <table className="mt-5 w-full">
          <thead className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="py-1.5">Item</th>
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5">
                  {l.description}
                  <div className="font-mono text-[11px] text-steel">{l.sku} · {money(l.unit_price)} ea</div>
                </td>
                <td className="py-1.5 text-right tabular-nums">{l.qty}</td>
                <td className="py-1.5 text-right tabular-nums">{money(l.qty * Number(l.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-0.5 border-t border-slate-300 pt-3">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(sale.subtotal)}</span></div>
          {taxes.map((t) => (
            <div key={t.component_name} className="flex justify-between text-steel">
              <span>{t.component_name} ({bpsToPercent(t.rate_bps)})</span>
              <span className="tabular-nums">{money(t.amount)}</span>
            </div>
          ))}
          {taxes.length === 0 && sale.exempt_reason && (
            <div className="flex justify-between text-steel"><span>HST</span><span>Exempt</span></div>
          )}
          <div className="flex justify-between pt-1 text-base font-bold">
            <span>Total</span><span className="tabular-nums">{money(sale.total)}</span>
          </div>
        </div>

        {sale.exempt_reason && (
          <p className="mt-3 text-center text-xs text-steel">
            No HST charged. {EXEMPT_REASON_LABELS[sale.exempt_reason] ?? sale.exempt_reason}
            {sale.exempt_reference && ` · ${sale.exempt_reference}`}
          </p>
        )}

        {shop?.invoice_footer && (
          <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-steel">{shop.invoice_footer}</p>
        )}
      </article>
    </div>
  );
}
