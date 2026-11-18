import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, inShop } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getOrder } from "@/lib/queries";
import type { InvoiceLogoPosition, InvoiceTemplate } from "@/lib/admin-queries";
import { PrintButton } from "@/components/PrintButton";
import { ClassicTemplate, ModernTemplate, MinimalTemplate } from "./templates";

export const dynamic = "force-dynamic";

/**
 * The customer-facing document. It is a quote until the job is invoiced, and an
 * invoice after. Deliberately shows no part cost, no actual hours and no
 * internal notes — only what the customer is charged.
 *
 * Which of the three layouts (templates.tsx) renders, and where the logo
 * sits within it, is a per-shop choice made on My Shop > Details.
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
      hst_number: string | null; name: string;
      invoice_template: InvoiceTemplate; invoice_logo_position: InvoiceLogoPosition }[]
  >`SELECT s.legal_name, s.address_line1, s.city, s.region, s.postal_code, s.phone,
           s.email, s.logo_url, s.invoice_footer, s.hst_number, t.name,
           coalesce(s.invoice_template, 'classic') AS invoice_template,
           coalesce(s.invoice_logo_position, 'left') AS invoice_logo_position
    FROM grip.tenants t LEFT JOIN grip.tenant_settings s ON s.tenant_id = t.id
    WHERE t.id = ${session.tenantId}`);

  const isInvoice = ["invoiced", "paid"].includes(order.status);
  const docTitle = isInvoice ? "Invoice" : "Quote";
  const docDate = order.invoiced_at ?? order.created_at;

  const Template = { classic: ClassicTemplate, modern: ModernTemplate, minimal: MinimalTemplate }[
    shop?.invoice_template ?? "classic"
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/app/orders/${order.id}`} className="text-sm text-steel hover:text-ink">
          ← Back to work order
        </Link>
        <PrintButton />
      </div>

      <Template
        shop={shop}
        order={order}
        labour={labour}
        parts={parts}
        taxes={taxes}
        isInvoice={isInvoice}
        docTitle={docTitle}
        docDate={docDate}
        logoPosition={shop?.invoice_logo_position ?? "left"}
      />
    </div>
  );
}
