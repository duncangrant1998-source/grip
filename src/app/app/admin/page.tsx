import Link from "next/link";
import { requireDepartment } from "@/lib/auth";
import { getReport, listStaff, whoIsOnClock } from "@/lib/admin-queries";
import { getScheduleContext } from "@/lib/schedule-queries";
import { addDays, startOfWeek } from "@/lib/dates";
import { formatDuration } from "@/lib/dates";
import { money } from "@/lib/format";
import { LiveRefresh } from "@/components/LiveRefresh";
import { card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await requireDepartment("admin");
  const ctx = await getScheduleContext(session);

  const from = startOfWeek(ctx.today);
  const [staff, onClock, report] = await Promise.all([
    listStaff(session),
    whoIsOnClock(session),
    getReport(session, from, addDays(ctx.today, 1), "week"),
  ]);

  const active = staff.filter((s) => s.is_active);
  const week = report.revenue.reduce(
    (a, r) => ({ labour: a.labour + Number(r.labour), parts: a.parts + Number(r.parts) }),
    { labour: 0, parts: 0 },
  );
  const p = report.projection;

  const tiles = [
    { label: "Revenue this week", value: money(week.labour + week.parts), href: "/app/reports", sub: "labour + parts, before tax" },
    { label: "Projected this month", value: money(p.projected_month), href: "/app/reports", sub: `${money(p.mtd_revenue)} so far` },
    { label: "Work in progress", value: money(p.wip_value), href: "/app/orders", sub: `${p.wip_orders} open order${p.wip_orders === "1" ? "" : "s"}` },
    { label: "On the clock now", value: String(onClock.length), href: "/app/admin/timesheets", sub: `of ${active.length} staff` },
  ];

  return (
    <div className="space-y-6">
      <LiveRefresh everyMs={30000} />
      <h1 className="text-2xl font-bold">Administration</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`${card} p-5 transition hover:border-slate-300`}>
            <div className="text-2xl font-bold tabular-nums">{t.value}</div>
            <div className="mt-1 text-sm">{t.label}</div>
            <div className="text-xs text-steel">{t.sub}</div>
          </Link>
        ))}
      </div>

      <section className={`${card} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">On the clock</h2>
        {onClock.length === 0 ? (
          <p className="px-5 py-6 text-sm text-steel">Nobody is clocked in.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {onClock.map((o) => (
              <li key={o.employee_id} className="flex items-center justify-between px-5 py-2.5">
                <span>
                  <span className="font-medium">{o.full_name}</span>
                  {o.work_order_number && <span className="text-steel"> · on #{o.work_order_number}</span>}
                </span>
                <span className="text-steel">since {o.since_time} · {formatDuration(o.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 text-sm sm:grid-cols-3">
        {[
          ["/app/admin/staff", "Staff", "People, pay rates and who can sign in."],
          ["/app/admin/shifts", "Shifts", "Plan the week for each person."],
          ["/app/shop", "My Shop", "Bays, hours, labour rate, tax and what prints on a document."],
        ].map(([href, title, blurb]) => (
          <Link key={href} href={href} className={`${card} p-5 transition hover:border-slate-300`}>
            <div className="font-semibold">{title}</div>
            <div className="text-steel">{blurb}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
