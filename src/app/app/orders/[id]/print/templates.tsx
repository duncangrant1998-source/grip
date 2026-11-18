import { EXEMPT_REASON_LABELS, bpsToPercent, date, hours, money } from "@/lib/format";
import type { InvoiceLogoPosition } from "@/lib/admin-queries";
import type { OrderDetail, LabourLine, PartLine, TaxLine } from "@/lib/queries";

/**
 * The three built-in print layouts, chosen in My Shop > Details and applied
 * here. All three show the same data (see print/page.tsx for what's
 * deliberately left off a customer-facing document) — only the arrangement
 * changes. `logoPosition` is honoured by all three so a shop isn't locked
 * into one look just to move its logo.
 */

type Shop = {
  legal_name: string | null; name: string; address_line1: string | null; city: string | null;
  region: string | null; postal_code: string | null; phone: string | null; email: string | null;
  logo_url: string | null; invoice_footer: string | null; hst_number: string | null;
};

type Order = OrderDetail;
type Labour = LabourLine;
type Part = PartLine;
type Tax = TaxLine;

export type PrintProps = {
  shop: Shop | undefined;
  order: Order;
  labour: Labour[];
  parts: Part[];
  taxes: Tax[];
  isInvoice: boolean;
  docTitle: string;
  docDate: Date | null;
  logoPosition: InvoiceLogoPosition;
};

function shopAddress(shop: Shop | undefined) {
  return [shop?.address_line1, [shop?.city, shop?.region].filter(Boolean).join(", "), shop?.postal_code]
    .filter(Boolean).join(" · ");
}

function Logo({ shop, className }: { shop: Shop | undefined; className?: string }) {
  if (!shop?.logo_url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={shop.logo_url} alt="" className={className} />;
}

function justifyFor(pos: InvoiceLogoPosition) {
  return pos === "left" ? "items-start" : pos === "right" ? "items-end" : "items-center";
}

// --- Classic -------------------------------------------------------------------------
// The original Grip layout: plain two-column header, shop details opposite the
// document title and totals. Businesslike, no colour.

export function ClassicTemplate(p: PrintProps) {
  const { shop, order, labour, parts, taxes, isInvoice, docTitle, docDate, logoPosition } = p;
  const headerOrder = logoPosition === "right" ? "flex-row-reverse" : "flex-row";
  const textAlign = logoPosition === "right" ? "text-right" : "text-left";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-10 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className={`flex items-start justify-between gap-6 ${headerOrder}`}>
        <div className={textAlign}>
          <Logo shop={shop} className="mb-2 h-12" />
          <h1 className="text-xl font-bold">{shop?.legal_name ?? shop?.name}</h1>
          <p className="text-sm text-steel">{shopAddress(shop)}</p>
          <p className="text-sm text-steel">{[shop?.phone, shop?.email].filter(Boolean).join(" · ")}</p>
          {shop?.hst_number && <p className="text-sm text-steel">HST {shop.hst_number}</p>}
        </div>
        <div className={logoPosition === "right" ? "text-left" : "text-right"}>
          <div className="text-2xl font-bold uppercase tracking-wide">{docTitle}</div>
          <div className="text-sm text-steel">#{order.number}</div>
          <div className="text-sm text-steel">{date(docDate)}</div>
          <StatusBadge order={order} />
        </div>
      </header>

      <CustomerVehicle order={order} className="mt-8 grid gap-6 text-sm sm:grid-cols-2" />
      {order.concern && <p className="mt-6 text-sm"><span className="font-semibold">Concern: </span>{order.concern}</p>}
      <LabourTable labour={labour} className="mt-8" />
      <PartsTable parts={parts} className="mt-6" />
      {order.notes && <Notes notes={order.notes} className="mt-6" />}

      <section className="ml-auto mt-8 max-w-xs space-y-1 text-sm">
        <Totals order={order} taxes={taxes} isInvoice={isInvoice} />
      </section>
      <ExemptNote order={order} className="mt-6" />
      <QuoteDisclaimer isInvoice={isInvoice} className="mt-8" />
      {shop?.invoice_footer && <Footer text={shop.invoice_footer} className="mt-8 border-t border-slate-200 pt-4" />}
    </article>
  );
}

// --- Modern --------------------------------------------------------------------------
// A coloured header band carries the logo and title; totals get a highlighted box.

export function ModernTemplate(p: PrintProps) {
  const { shop, order, labour, parts, taxes, isInvoice, docTitle, docDate, logoPosition } = p;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <div className="bg-navy px-10 py-6 text-white print:bg-navy print:text-white">
        <div className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div className={`flex flex-col gap-1 ${justifyFor(logoPosition)}`}>
            <Logo shop={shop} className="mb-1 h-10 brightness-0 invert" />
            <div className="text-lg font-bold">{shop?.legal_name ?? shop?.name}</div>
            <div className="text-xs text-blueline">{shopAddress(shop)}</div>
            <div className="text-xs text-blueline">{[shop?.phone, shop?.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-extrabold uppercase tracking-wide text-shop">{docTitle}</div>
            <div className="text-xs text-blueline">#{order.number} · {date(docDate)}</div>
            <StatusBadge order={order} inverted />
          </div>
        </div>
      </div>

      <div className="p-10 pt-8">
        {shop?.hst_number && <p className="mb-4 text-xs text-steel">HST {shop.hst_number}</p>}
        <CustomerVehicle order={order} className="grid gap-6 text-sm sm:grid-cols-2" />
        {order.concern && <p className="mt-6 text-sm"><span className="font-semibold">Concern: </span>{order.concern}</p>}
        <LabourTable labour={labour} className="mt-8" />
        <PartsTable parts={parts} className="mt-6" />
        {order.notes && <Notes notes={order.notes} className="mt-6" />}

        <section className="ml-auto mt-8 max-w-xs space-y-1 rounded-lg bg-slate-50 p-4 text-sm">
          <Totals order={order} taxes={taxes} isInvoice={isInvoice} />
        </section>
        <ExemptNote order={order} className="mt-6" />
        <QuoteDisclaimer isInvoice={isInvoice} className="mt-8" />
        {shop?.invoice_footer && <Footer text={shop.invoice_footer} className="mt-8 border-t border-slate-200 pt-4" />}
      </div>
    </article>
  );
}

// --- Minimal -------------------------------------------------------------------------
// Centred, quiet, generous whitespace, thin rules instead of boxed tables.

export function MinimalTemplate(p: PrintProps) {
  const { shop, order, labour, parts, taxes, isInvoice, docTitle, docDate, logoPosition } = p;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-12 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className={`flex flex-col gap-2 text-center ${justifyFor(logoPosition)}`}>
        <Logo shop={shop} className="mb-1 h-10" />
        <h1 className="text-lg font-semibold tracking-wide">{shop?.legal_name ?? shop?.name}</h1>
        <p className="text-xs text-steel">{shopAddress(shop)}</p>
        <p className="text-xs text-steel">{[shop?.phone, shop?.email].filter(Boolean).join(" · ")}</p>
        {shop?.hst_number && <p className="text-xs text-steel">HST {shop.hst_number}</p>}
        <div className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-steel">{docTitle}</div>
        <div className="text-xs text-steel">#{order.number} · {date(docDate)}</div>
        <div className="flex justify-center"><StatusBadge order={order} /></div>
      </header>

      <div className="mx-auto mt-10 h-px w-16 bg-slate-200" />

      <CustomerVehicle order={order} className="mx-auto mt-8 grid max-w-xl gap-6 text-sm sm:grid-cols-2" />
      {order.concern && (
        <p className="mx-auto mt-6 max-w-xl text-center text-sm">
          <span className="font-semibold">Concern: </span>{order.concern}
        </p>
      )}

      <div className="mx-auto mt-10 max-w-xl">
        <LabourTable labour={labour} className="" bare />
        <PartsTable parts={parts} className="mt-6" bare />
        {order.notes && <Notes notes={order.notes} className="mt-6" />}

        <section className="mx-auto mt-10 max-w-xs space-y-1 text-sm">
          <Totals order={order} taxes={taxes} isInvoice={isInvoice} />
        </section>
        <ExemptNote order={order} className="mt-6 text-center" />
        <QuoteDisclaimer isInvoice={isInvoice} className="mt-8 text-center" />
        {shop?.invoice_footer && (
          <Footer text={shop.invoice_footer} className="mt-10 border-t border-slate-100 pt-4 text-center" />
        )}
      </div>
    </article>
  );
}

// --- shared pieces ---------------------------------------------------------------------

function StatusBadge({ order, inverted }: { order: Order; inverted?: boolean }) {
  if (order.status === "paid") {
    return (
      <div className={`mt-1 inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase ${
        inverted ? "border-emerald-400 text-emerald-300" : "border-emerald-600 text-emerald-700"
      }`}>
        Paid
      </div>
    );
  }
  if (order.status === "cancelled") {
    return (
      <div className={`mt-1 inline-block rounded border px-2 py-0.5 text-xs font-bold uppercase ${
        inverted ? "border-red-400 text-red-300" : "border-red-600 text-red-700"
      }`}>
        Cancelled
      </div>
    );
  }
  return null;
}

function CustomerVehicle({ order, className }: { order: Order; className: string }) {
  return (
    <section className={className}>
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
  );
}

function LabourTable({ labour, className, bare }: { labour: Labour[]; className: string; bare?: boolean }) {
  if (labour.length === 0) return null;
  return (
    <table className={`w-full text-sm ${className}`}>
      <thead className={`border-b ${bare ? "border-slate-200" : "border-slate-300"} text-left text-xs uppercase tracking-wide text-steel`}>
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
  );
}

function PartsTable({ parts, className, bare }: { parts: Part[]; className: string; bare?: boolean }) {
  if (parts.length === 0) return null;
  return (
    <table className={`w-full text-sm ${className}`}>
      <thead className={`border-b ${bare ? "border-slate-200" : "border-slate-300"} text-left text-xs uppercase tracking-wide text-steel`}>
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
  );
}

function Notes({ notes, className }: { notes: string; className: string }) {
  return (
    <section className={`text-sm ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-steel">Notes</div>
      <p className="mt-1 whitespace-pre-wrap">{notes}</p>
    </section>
  );
}

function Totals({ order, taxes, isInvoice }: { order: Order; taxes: Tax[]; isInvoice: boolean }) {
  return (
    <>
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
    </>
  );
}

function ExemptNote({ order, className }: { order: Order; className: string }) {
  if (!order.exempt_reason) return null;
  return (
    <p className={`text-xs text-steel ${className}`}>
      <strong>No HST charged.</strong>{" "}
      {EXEMPT_REASON_LABELS[order.exempt_reason] ?? order.exempt_reason}
      {order.exempt_reference && ` · ${order.exempt_reference}`}
    </p>
  );
}

function QuoteDisclaimer({ isInvoice, className }: { isInvoice: boolean; className: string }) {
  if (isInvoice) return null;
  return <p className={`text-xs text-steel ${className}`}>This is a quote, not a bill. Final amounts may differ if the scope of work changes.</p>;
}

function Footer({ text, className }: { text: string; className: string }) {
  return <p className={`text-xs text-steel ${className}`}>{text}</p>;
}

function Line({ label, value, bold, large }: { label: string; value: string; bold?: boolean; large?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${large ? "text-lg" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
