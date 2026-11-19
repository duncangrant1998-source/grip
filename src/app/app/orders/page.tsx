import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can, canTransition, type WorkOrderStatus } from "@/lib/permissions";
import { listOrders } from "@/lib/queries";
import { dateTime, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ClickRow } from "@/components/ClickRow";
import { SectionShell } from "@/components/SectionShell";
import { ServiceNav } from "@/components/ServiceNav";
import { StatusBadge } from "@/components/StatusBadge";
import { btn, btnGhost, card, input } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { transition } from "./actions";

export const dynamic = "force-dynamic";

const SCOPES = {
  quotes: { title: "Quotes", blurb: "Waiting for the customer to approve." },
  open: { title: "Open orders", blurb: "Approved, in the bay, or finished and waiting to be invoiced." },
  closed: { title: "Closed orders", blurb: "Invoiced, paid or cancelled." },
  all: { title: "All work orders", blurb: "" },
} as const;
type Scope = keyof typeof SCOPES;

// The one button a row offers: move the job to its next stage.
const NEXT_STEP: Record<string, { to: WorkOrderStatus; label: string } | undefined> = {
  quote: { to: "approved", label: "Approve" },
  approved: { to: "in_progress", label: "Start work" },
  in_progress: { to: "completed", label: "Complete" },
  completed: { to: "invoiced", label: "Invoice" },
  invoiced: { to: "paid", label: "Mark paid" },
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; q?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "workorders.view", session.extraRoles)) redirect("/app?denied=orders");

  const sp = await searchParams;
  const scope: Scope = sp.scope && sp.scope in SCOPES ? (sp.scope as Scope) : "open";
  const q = (sp.q ?? "").trim();

  const orders = await listOrders(session, { scope, q });
  const isTech = session.role === "technician";
  const showTabs = can(session.role, "appointments.view", session.extraRoles) || session.role !== "parts_advisor";

  return (
    <SectionShell
      nav={
        showTabs ? (
          <ServiceNav role={session.role} extraRoles={session.extraRoles} active={scope === "all" ? "open" : scope} />
        ) : undefined
      }
    >
    <div className="space-y-5">
      <LiveRefresh everyMs={10000} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{SCOPES[scope].title}</h1>
          <p className="text-sm text-steel">
            {isTech ? "Jobs assigned to you. " : ""}{SCOPES[scope].blurb}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <form className="flex w-full gap-2 sm:w-auto">
            <input type="hidden" name="scope" value={scope} />
            <input
              name="q" defaultValue={q} aria-label="Search work orders"
              placeholder="Number, customer, VIN, plate…"
              className={`${input} min-w-0 flex-1 sm:w-72 sm:flex-none`}
            />
            <button className={btn}>Search</button>
          </form>
          {can(session.role, "workorders.create", session.extraRoles) && (
            <Link href="/app/orders/new" className={btn}>New quote</Link>
          )}
        </div>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Concern</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Updated</th>
              <th className="px-4 py-3 text-right">Move to next stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => {
              const next = NEXT_STEP[o.status];
              const may = next && canTransition(session.role, next.to, session.extraRoles);
              return (
                <ClickRow key={o.id} href={`/app/orders/${o.id}`}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/app/orders/${o.id}`} className="hover:underline">#{o.number}</Link>
                  </td>
                  <td className="px-4 py-3">{o.customer_name}</td>
                  <td className="px-4 py-3 text-steel">{o.vehicle}</td>
                  <td className="max-w-md truncate px-4 py-3 text-steel">{o.concern}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(o.total)}</td>
                  <td className="px-4 py-3 text-right text-xs text-steel">{dateTime(o.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {may && next && (
                      <ActionForm action={transition} className="inline-block">
                        <input type="hidden" name="work_order_id" value={o.id} />
                        <input type="hidden" name="to" value={next.to} />
                        <button className={btnGhost}>{next.label}</button>
                      </ActionForm>
                    )}
                  </td>
                </ClickRow>
              );
            })}
            {orders.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-steel">
                Nothing here{q ? " matches that search" : " right now"}.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </SectionShell>
  );
}
