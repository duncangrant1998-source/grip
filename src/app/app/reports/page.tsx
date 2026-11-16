import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getReport } from "@/lib/admin-queries";
import { getScheduleContext } from "@/lib/schedule-queries";
import {
  addDays, addMonths, daysBetween, formatMonthDay, formatShort, isDateString, startOfMonth,
} from "@/lib/dates";
import { money } from "@/lib/format";
import { RevenueChart } from "@/components/RevenueChart";
import { btn, btnGhost, card, input, label } from "@/components/ui";

export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const num = (v: string | number) => Number(v);

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; grain?: string }>;
}) {
  const session = await requireSession();
  const full = can(session.role, "reports.margin");
  const partsOnly = !full && can(session.role, "reports.partsOnly");
  if (!full && !partsOnly) redirect("/app?denied=reports");

  const ctx = await getScheduleContext(session);
  const sp = await searchParams;

  // Dates are the shop's calendar days; `to` is shown inclusive and queried exclusive.
  const from = isDateString(sp.from) ? sp.from : startOfMonth(ctx.today);
  const toIncl = isDateString(sp.to) ? sp.to : ctx.today;
  const toExcl = addDays(toIncl, 1);
  const span = daysBetween(from, toExcl);

  const auto = span <= 35 ? "day" : span <= 140 ? "week" : "month";
  const grain = (["day", "week", "month"].includes(sp.grain ?? "") ? sp.grain : auto) as "day" | "week" | "month";

  const r = await getReport(session, from, toExcl, grain);

  // --- totals -----------------------------------------------------------------------
  const labourRev = r.revenue.reduce((a, x) => a + num(x.labour), 0);
  const partsRev = r.revenue.reduce((a, x) => a + num(x.parts), 0);
  const tax = r.revenue.reduce((a, x) => a + num(x.tax), 0);
  const partsCost = r.revenue.reduce((a, x) => a + num(x.parts_cost), 0);
  const billedHours = r.revenue.reduce((a, x) => a + num(x.billed_hours), 0);
  const docs = r.revenue.reduce((a, x) => a + num(x.documents), 0);
  const payroll = r.payroll.reduce((a, x) => a + num(x.payroll_cost), 0);
  const clocked = r.payroll.reduce((a, x) => a + num(x.clocked_hours), 0);

  const partsProfit = partsRev - partsCost;
  const labourProfit = labourRev - payroll;
  const haveClock = clocked > 0;
  const revenue = labourRev + partsRev;
  const gross = partsProfit + (haveClock ? labourProfit : labourRev);

  const payrollByPeriod = new Map(r.payroll.map((p) => [p.period, num(p.payroll_cost)]));
  const label_ = (period: string) =>
    grain === "month" ? new Intl.DateTimeFormat("en-CA", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(period + "T00:00:00Z"))
    : grain === "week" ? `${formatMonthDay(period)}`
    : formatMonthDay(period);

  // --- presets ----------------------------------------------------------------------
  const monthStart = startOfMonth(ctx.today);
  const presets = [
    ["This month", monthStart, ctx.today],
    ["Last month", addMonths(monthStart, -1), addDays(monthStart, -1)],
    ["Last 30 days", addDays(ctx.today, -29), ctx.today],
    ["Last 90 days", addDays(ctx.today, -89), ctx.today],
    ["Year to date", `${ctx.today.slice(0, 4)}-01-01`, ctx.today],
  ];

  const p = r.projection;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{partsOnly ? "Parts sales" : "Reports"}</h1>
          <p className="text-sm text-steel">
            {formatShort(from)} – {formatShort(toIncl)} · {docs} invoice{docs === 1 ? "" : "s"} and sale{docs === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map(([l, f, t]) => (
            <Link key={l} href={`/app/reports?from=${f}&to=${t}`} className={btnGhost}>{l}</Link>
          ))}
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className={label} htmlFor="from">From</label>
          <input id="from" type="date" name="from" defaultValue={from} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="to">To</label>
          <input id="to" type="date" name="to" defaultValue={toIncl} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="grain">Group by</label>
          <select id="grain" name="grain" defaultValue={grain} className={input}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>
        <button className={btn}>Show</button>
      </form>

      <p className="rounded-md bg-slate-100 px-4 py-2.5 text-xs text-slate-600">
        Revenue counts work orders when they are <b>invoiced</b> and counter sales when they are <b>completed</b>,
        on the shop&apos;s calendar day, before tax. Quotes, open jobs and cancelled orders are not included.
      </p>

      {/* Headline numbers ------------------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(partsOnly
          ? [
              ["Parts revenue", money(partsRev), `${money(tax)} tax collected`],
              ["Parts cost", money(partsCost), "what the parts cost you"],
              ["Parts profit", money(partsProfit), `${pct(partsProfit, partsRev)} margin`],
            ]
          : [
              ["Revenue", money(revenue), `${money(labourRev)} labour · ${money(partsRev)} parts`],
              ["Gross profit", money(gross), `${pct(gross, revenue)} of revenue`],
              ["Parts margin", pct(partsProfit, partsRev), `${money(partsProfit)} on ${money(partsRev)}`],
              ["Labour margin", haveClock ? pct(labourProfit, labourRev) : "—",
                haveClock ? `${money(labourProfit)} after ${money(payroll)} technician pay` : "needs time clock data"],
            ]
        ).map(([l, v, s]) => (
          <div key={l} className={`${card} p-5`}>
            <div className="text-xs text-steel">{l}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{v}</div>
            <div className="mt-0.5 text-xs text-steel">{s}</div>
          </div>
        ))}
      </div>

      {!partsOnly && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={`${card} p-5`}>
            <div className="text-xs text-steel">Effective labour rate</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{haveClock ? money(labourRev / clocked) : "—"}</div>
            <div className="mt-0.5 text-xs text-steel">labour revenue per hour technicians were on the clock</div>
          </div>
          <div className={`${card} p-5`}>
            <div className="text-xs text-steel">Average billed rate</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{billedHours > 0 ? money(labourRev / billedHours) : "—"}</div>
            <div className="mt-0.5 text-xs text-steel">labour revenue per hour billed ({billedHours.toFixed(1)} h)</div>
          </div>
          <div className={`${card} p-5`}>
            <div className="text-xs text-steel">Technician hours billed</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{haveClock ? pct(billedHours, clocked) : "—"}</div>
            <div className="mt-0.5 text-xs text-steel">of {clocked.toFixed(1)} h clocked ({billedHours.toFixed(1)} h billed)</div>
          </div>
        </div>
      )}

      {/* Revenue over time ---------------------------------------------------------- */}
      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">{partsOnly ? "Parts sales" : "Revenue"} by {grain}</h2>
        {r.revenue.length === 0 ? (
          <p className="py-8 text-center text-sm text-steel">Nothing was invoiced or sold in this range.</p>
        ) : (
          <RevenueChart
            showLabour={!partsOnly}
            points={r.revenue.map((x) => ({ label: label_(x.period), labour: num(x.labour), parts: num(x.parts) }))}
          />
        )}
      </section>

      {r.revenue.length > 0 && (
        <section className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2.5">{grain === "week" ? "Week of" : grain === "month" ? "Month" : "Day"}</th>
                {!partsOnly && <th className="px-3 py-2.5 text-right">Labour</th>}
                <th className="px-3 py-2.5 text-right">Parts</th>
                {!partsOnly && <th className="px-3 py-2.5 text-right">Total</th>}
                <th className="px-3 py-2.5 text-right">Parts cost</th>
                {!partsOnly && <th className="px-3 py-2.5 text-right">Tech pay</th>}
                <th className="px-3 py-2.5 text-right">Gross profit</th>
                <th className="px-5 py-2.5 text-right">Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.revenue.map((x) => {
                const pay = payrollByPeriod.get(x.period) ?? 0;
                const gp = num(x.parts) - num(x.parts_cost) + (partsOnly ? 0 : haveClock ? num(x.labour) - pay : num(x.labour));
                return (
                  <tr key={x.period}>
                    <td className="px-5 py-2.5 font-medium">{grain === "month" ? label_(x.period) : formatShort(x.period)}</td>
                    {!partsOnly && <td className="px-3 py-2.5 text-right tabular-nums">{money(x.labour)}</td>}
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(x.parts)}</td>
                    {!partsOnly && <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(num(x.labour) + num(x.parts))}</td>}
                    <td className="px-3 py-2.5 text-right tabular-nums text-steel">{money(x.parts_cost)}</td>
                    {!partsOnly && <td className="px-3 py-2.5 text-right tabular-nums text-steel">{pay ? money(pay) : "—"}</td>}
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(gp)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-steel">{money(x.tax)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-slate-200 font-semibold">
              <tr>
                <td className="px-5 py-2.5">Total</td>
                {!partsOnly && <td className="px-3 py-2.5 text-right tabular-nums">{money(labourRev)}</td>}
                <td className="px-3 py-2.5 text-right tabular-nums">{money(partsRev)}</td>
                {!partsOnly && <td className="px-3 py-2.5 text-right tabular-nums">{money(revenue)}</td>}
                <td className="px-3 py-2.5 text-right tabular-nums">{money(partsCost)}</td>
                {!partsOnly && <td className="px-3 py-2.5 text-right tabular-nums">{payroll ? money(payroll) : "—"}</td>}
                <td className="px-3 py-2.5 text-right tabular-nums">{money(partsOnly ? partsProfit : gross)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{money(tax)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {/* Technicians ----------------------------------------------------------------- */}
      {!partsOnly && (
        <section className={`${card} overflow-x-auto`}>
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold">Technician efficiency</h2>
            <p className="text-xs text-steel">
              <b>Efficiency</b> is billed hours ÷ hours actually spent on the jobs (over 100% beats book time; a
              straight-time shop reads 100% by design). <b>Hours billed</b> is billed hours ÷ hours on the clock.
            </p>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2.5">Technician</th>
                <th className="px-3 py-2.5 text-right">Billed</th>
                <th className="px-3 py-2.5 text-right">Spent</th>
                <th className="px-3 py-2.5 text-right">Efficiency</th>
                <th className="px-3 py-2.5 text-right">Clocked</th>
                <th className="px-3 py-2.5 text-right">Hours billed</th>
                <th className="px-3 py-2.5 text-right">Labour revenue</th>
                <th className="px-5 py-2.5 text-right">Per clocked hr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.techs.map((t) => {
                const b = num(t.billed_hours), a = num(t.actual_hours), c = num(t.clocked_hours);
                const eff = a > 0 ? b / a : null;
                return (
                  <tr key={t.employee_id}>
                    <td className="px-5 py-2.5 font-medium">{t.full_name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{b.toFixed(1)} h</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-steel">{a.toFixed(1)} h</td>
                    <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${eff === null ? "" : eff >= 1 ? "text-emerald-700" : "text-amber-700"}`}>
                      {eff === null ? "—" : `${(eff * 100).toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-steel">{c.toFixed(1)} h</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(b, c)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(t.labour_revenue)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-steel">{c > 0 ? money(num(t.labour_revenue) / c) : "—"}</td>
                  </tr>
                );
              })}
              {r.techs.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-6 text-center text-steel">
                  No technicians yet. Mark staff as technicians under Administration → Staff.
                </td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Projection ----------------------------------------------------------------- */}
      {!partsOnly && (
        <section className={`${card} p-5`}>
          <h2 className="font-semibold">Where this month is heading</h2>
          <p className="mb-4 text-xs text-steel">
            A simple run-rate, not a forecast: this month so far, plus the average daily revenue of the last 28 days
            for each day still to come.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs text-steel">Projected month-end revenue</div>
              <div className="text-2xl font-bold tabular-nums">{money(p.projected_month)}</div>
              <div className="text-xs text-steel">{money(p.mtd_revenue)} so far + {money(p.avg_daily)}/day × {p.days_remaining} days</div>
            </div>
            <div>
              <div className="text-xs text-steel">Work in progress</div>
              <div className="text-2xl font-bold tabular-nums">{money(p.wip_value)}</div>
              <div className="text-xs text-steel">{p.wip_orders} approved, started or finished but not yet invoiced</div>
            </div>
            <div>
              <div className="text-xs text-steel">Quotes outstanding</div>
              <div className="text-2xl font-bold tabular-nums">{money(p.quote_value)}</div>
              <div className="text-xs text-steel">{p.quote_orders} waiting on a customer</div>
            </div>
            <div>
              <div className="text-xs text-steel">Booked, next 7 days</div>
              <div className="text-2xl font-bold tabular-nums">{num(p.booked_hours_7d).toFixed(1)} h</div>
              <div className="text-xs text-steel">of appointments on the calendar</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
