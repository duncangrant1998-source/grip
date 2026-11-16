import Link from "next/link";
import { requireSession, inShop } from "@/lib/auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { visibleOrders } from "@/lib/queries";
import { countToday } from "@/lib/schedule-queries";
import { pendingTimeOffCount } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const session = await requireSession();
  const { denied } = await searchParams;

  // Each tile is gated by the same can() the rest of the app uses, so the
  // dashboard never advertises something the user would be refused.
  // "Today" is the shop's day, not the server's.
  const todayAppts = can(session.role, "appointments.view") ? await countToday(session) : 0;
  // Time off is addressed to a person, so anyone can have a request waiting on them.
  const timeOffWaiting = await pendingTimeOffCount(session, can(session.role, "staff.manage"));

  const stats = await inShop(session, async (tx) => {
    // Technicians count only their own jobs and appointments.
    const [openOrders] = await tx<{ n: string }[]>`
      SELECT count(*) AS n FROM grip.work_orders w
      WHERE w.status IN ('quote', 'approved', 'in_progress') ${visibleOrders(tx, session)}`;
    const [lowStock] = await tx<{ n: string }[]>`
      SELECT count(*) AS n FROM grip.parts p
      JOIN grip.part_stock s ON s.part_id = p.id
      WHERE p.is_active AND p.is_stocked AND p.reorder_point > 0
        AND (s.qty_on_hand - s.qty_reserved) <= p.reorder_point`;
    const [openPOs] = await tx<{ n: string }[]>`
      SELECT count(*) AS n FROM grip.purchase_orders
      WHERE status IN ('ordered', 'partial')`;
    const [staff] = await tx<{ n: string }[]>`
      SELECT count(*) AS n FROM grip.employees WHERE is_active`;
    return {
      openOrders: Number(openOrders.n),
      lowStock: Number(lowStock.n),
      openPOs: Number(openPOs.n),
      staff: Number(staff.n),
    };
  });

  const tiles = [
    can(session.role, "workorders.view") && {
      label: "Open work orders", value: stats.openOrders, href: "/app/orders",
    },
    can(session.role, "appointments.view") && {
      label: "Appointments today", value: todayAppts, href: "/app/schedule",
    },
    can(session.role, "inventory.view") && {
      label: "Parts at or below reorder point", value: stats.lowStock, href: "/app/parts?view=low",
    },
    can(session.role, "purchaseOrders.manage") && {
      label: "Purchase orders awaiting delivery", value: stats.openPOs, href: "/app/parts/orders",
    },
    can(session.role, "staff.manage") && {
      label: "Active staff", value: stats.staff, href: "/app/admin",
    },
    timeOffWaiting > 0 && {
      label: "Time-off requests waiting for you", value: timeOffWaiting,
      href: can(session.role, "staff.manage") ? "/app/admin/timeoff" : "/app/time?tab=timeoff",
    },
  ].filter(Boolean) as { label: string; value: number; href: string }[];

  return (
    <div className="space-y-6">
      {denied && (
        <p role="alert" className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your {ROLE_LABELS[session.role].toLowerCase()} login doesn&apos;t have access to{" "}
          {denied}.
        </p>
      )}

      <div>
        <h1 className="text-2xl font-bold">Welcome, {session.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-steel">{ROLE_LABELS[session.role]}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
          >
            <div className="text-3xl font-bold tabular-nums">{t.value}</div>
            <div className="mt-1 text-sm text-steel">{t.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
