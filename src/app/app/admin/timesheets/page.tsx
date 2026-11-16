import Link from "next/link";
import { requireDepartment } from "@/lib/auth";
import { listEntries, listFlatRateLines, listJobTime, listStaff, shiftMinutesByPerson, whoIsOnClock } from "@/lib/admin-queries";
import { getScheduleContext } from "@/lib/schedule-queries";
import { addDays, formatDuration, formatShort, isDateString, startOfWeek } from "@/lib/dates";
import { money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { deleteTimeEntry, saveTimeEntry } from "../actions";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; who?: string; mode?: string }>;
}) {
  const session = await requireDepartment("admin");
  const ctx = await getScheduleContext(session);
  const sp = await searchParams;

  const weekStart = startOfWeek(ctx.today);
  const from = isDateString(sp.from) ? sp.from : weekStart;
  const to = isDateString(sp.to) ? sp.to : addDays(from, 7); // exclusive
  const who = /^[0-9a-f-]{36}$/i.test(sp.who ?? "") ? sp.who! : undefined;
  const flat = sp.mode === "flat";
  const jobsMode = sp.mode === "jobs";
  const qs = (f: string, t: string) =>
    `from=${f}&to=${t}&mode=${flat ? "flat" : jobsMode ? "jobs" : "hourly"}${who ? `&who=${who}` : ""}`;

  // Time on jobs: how long people were on each work order, set against their shifts.
  if (jobsMode) {
    const [rows, shift, staff] = await Promise.all([
      listJobTime(session, from, to, who),
      shiftMinutesByPerson(session, from, to),
      listStaff(session),
    ]);
    const by = new Map<string, { name: string; jobs: Set<string>; minutes: number }>();
    for (const j of rows) {
      const t = by.get(j.employee_id) ?? { name: j.full_name, jobs: new Set<string>(), minutes: 0 };
      t.jobs.add(j.work_order_id);
      t.minutes += j.minutes;
      by.set(j.employee_id, t);
    }
    const hrs = (m: number) => (m / 60).toFixed(2);
    const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
    const totalJob = [...by.values()].reduce((n, t) => n + t.minutes, 0);
    const totalShift = [...by.keys()].reduce((n, id) => n + (shift.get(id) ?? 0), 0);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Timesheets</h1>
            <p className="text-sm text-steel">
              Time on jobs · {formatShort(from)} – {formatShort(addDays(to, -1))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/admin/timesheets?${qs(weekStart, addDays(weekStart, 7))}`} className={btnGhost}>This week</Link>
            <Link href={`/app/admin/timesheets?${qs(addDays(weekStart, -7), weekStart)}`} className={btnGhost}>Last week</Link>
            <Link href={`/app/admin/timesheets?${qs(addDays(weekStart, -21), addDays(weekStart, 7))}`} className={btnGhost}>Last 4 weeks</Link>
          </div>
        </div>

        <TimesheetFilters from={from} to={to} who={who} mode="jobs" staff={staff} />

        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Job time by person</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Person</th>
                <th className="px-3 py-2 text-right">Jobs</th>
                <th className="px-3 py-2 text-right">Hours on jobs</th>
                <th className="px-3 py-2 text-right">Shift hours</th>
                <th className="px-5 py-2 text-right">On jobs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...by.entries()].map(([id, t]) => (
                <tr key={id}>
                  <td className="px-5 py-2.5 font-medium">{t.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.jobs.size}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{hrs(t.minutes)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{hrs(shift.get(id) ?? 0)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{pct(t.minutes, shift.get(id) ?? 0)}</td>
                </tr>
              ))}
              {by.size === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-steel">No job time was logged in this range.</td></tr>
              )}
            </tbody>
            {by.size > 0 && (
              <tfoot className="border-t border-slate-200 font-semibold">
                <tr>
                  <td className="px-5 py-2.5">Total</td>
                  <td />
                  <td className="px-3 py-2.5 text-right tabular-nums">{hrs(totalJob)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{hrs(totalShift)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{pct(totalJob, totalShift)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>

        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Entries</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Person</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">In</th>
                <th className="px-3 py-2">Out</th>
                <th className="px-3 py-2">Job</th>
                <th className="px-5 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((j) => (
                <tr key={j.id}>
                  <td className="px-5 py-2.5 font-medium">{j.full_name}</td>
                  <td className="px-3 py-2.5 text-steel">{j.local_date}</td>
                  <td className="px-3 py-2.5 tabular-nums">{j.in_time}</td>
                  <td className="px-3 py-2.5 tabular-nums">{j.out_time ?? <span className="text-emerald-700">open</span>}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/app/orders/${j.work_order_id}`} className="underline">#{j.work_order_number}</Link>{" "}
                    <span className="text-steel">{j.customer}, {j.vehicle}</span>
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatDuration(j.minutes)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-steel">Nothing here.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  if (flat) {
    const [lines, staff] = await Promise.all([listFlatRateLines(session, from, to, who), listStaff(session)]);
    const by = new Map<string, { name: string; jobs: Set<string>; billed: number; actual: number }>();
    for (const l of lines) {
      const t = by.get(l.employee_id) ?? { name: l.full_name, jobs: new Set<string>(), billed: 0, actual: 0 };
      t.jobs.add(l.work_order_id);
      t.billed += Number(l.billed_hours);
      t.actual += Number(l.actual_hours);
      by.set(l.employee_id, t);
    }
    const sum = [...by.values()].reduce((a, t) => ({ b: a.b + t.billed, c: a.c + t.actual }), { b: 0, c: 0 });
    const eff = (b: number, a: number) => (a > 0 ? `${Math.round((b / a) * 100)}%` : "—");

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Timesheets</h1>
            <p className="text-sm text-steel">
              Flat-rate hours · {formatShort(from)} – {formatShort(addDays(to, -1))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/admin/timesheets?${qs(weekStart, addDays(weekStart, 7))}`} className={btnGhost}>This week</Link>
            <Link href={`/app/admin/timesheets?${qs(addDays(weekStart, -7), weekStart)}`} className={btnGhost}>Last week</Link>
            <Link href={`/app/admin/timesheets?${qs(addDays(weekStart, -21), addDays(weekStart, 7))}`} className={btnGhost}>Last 4 weeks</Link>
          </div>
        </div>

        <TimesheetFilters from={from} to={to} who={who} mode="flat" staff={staff} />

        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Flat-rate hours by person</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Person</th>
                <th className="px-3 py-2 text-right">Jobs</th>
                <th className="px-3 py-2 text-right">Flat hours</th>
                <th className="px-3 py-2 text-right">Actual hours</th>
                <th className="px-5 py-2 text-right">Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...by.entries()].map(([id, t]) => (
                <tr key={id}>
                  <td className="px-5 py-2.5 font-medium">{t.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.jobs.size}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.billed.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.actual.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{eff(t.billed, t.actual)}</td>
                </tr>
              ))}
              {by.size === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-steel">No flat-rate jobs were completed in this range.</td></tr>
              )}
            </tbody>
            {by.size > 0 && (
              <tfoot className="border-t border-slate-200 font-semibold">
                <tr>
                  <td className="px-5 py-2.5">Total</td>
                  <td />
                  <td className="px-3 py-2.5 text-right tabular-nums">{sum.b.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{sum.c.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{eff(sum.b, sum.c)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>

        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Jobs</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Person</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Work</th>
                <th className="px-3 py-2 text-right">Flat</th>
                <th className="px-5 py-2 text-right">Actual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-2.5 font-medium">{l.full_name}</td>
                  <td className="px-3 py-2.5 text-steel">{l.done_date}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/app/orders/${l.work_order_id}`} className="underline">#{l.work_order_number}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-steel">{l.description}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{Number(l.billed_hours).toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{Number(l.actual_hours).toFixed(2)}</td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-steel">Nothing here.</td></tr>}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-steel">
          Counts flat-rate labour lines assigned to the person on jobs completed in the range. Flat hours are
          what the job pays; actual is the time it took; efficiency is flat ÷ actual.
        </p>
      </div>
    );
  }

  const [entries, staff, onClock] = await Promise.all([
    listEntries(session, from, to, who),
    listStaff(session),
    whoIsOnClock(session),
  ]);

  // Totals per person. Open entries are shown but not counted until closed.
  const totals = new Map<string, { name: string; minutes: number; cost: number; open: boolean }>();
  for (const e of entries) {
    const rate = Number(staff.find((s) => s.id === e.employee_id)?.hourly_rate ?? 0);
    const t = totals.get(e.employee_id) ?? { name: e.full_name, minutes: 0, cost: 0, open: false };
    if (e.minutes != null) {
      t.minutes += e.minutes;
      t.cost += (e.minutes / 60) * rate;
    } else t.open = true;
    totals.set(e.employee_id, t);
  }
  const grand = [...totals.values()].reduce((a, t) => ({ m: a.m + t.minutes, c: a.c + t.cost }), { m: 0, c: 0 });

  const range = (label: string, f: string, t: string) => (
    <Link href={`/app/admin/timesheets?${qs(f, t)}`} className={btnGhost}>{label}</Link>
  );

  return (
    <div className="space-y-6">
      <LiveRefresh everyMs={30000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Timesheets</h1>
          <p className="text-sm text-steel">
            {formatShort(from)} – {formatShort(addDays(to, -1))}
            {onClock.length > 0 && ` · ${onClock.length} on the clock now`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {range("This week", weekStart, addDays(weekStart, 7))}
          {range("Last week", addDays(weekStart, -7), weekStart)}
          {range("Last 4 weeks", addDays(weekStart, -21), addDays(weekStart, 7))}
        </div>
      </div>

      <TimesheetFilters from={from} to={to} who={who} mode="hourly" staff={staff} />

      <section className={`${card} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Hours by person</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Person</th>
              <th className="px-3 py-2 text-right">Hours</th>
              <th className="px-5 py-2 text-right">Wage cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...totals.entries()].map(([id, t]) => (
              <tr key={id}>
                <td className="px-5 py-2.5 font-medium">
                  {t.name}{t.open && <span className="ml-2 text-xs font-normal text-emerald-700">on the clock</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{(t.minutes / 60).toFixed(2)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{money(t.cost)}</td>
              </tr>
            ))}
            {totals.size === 0 && (
              <tr><td colSpan={3} className="px-5 py-6 text-center text-steel">No time recorded in this range.</td></tr>
            )}
          </tbody>
          {totals.size > 0 && (
            <tfoot className="border-t border-slate-200 font-semibold">
              <tr>
                <td className="px-5 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{(grand.m / 60).toFixed(2)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{money(grand.c)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <section className={`${card} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Entries</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Person</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">In</th>
              <th className="px-3 py-2">Out</th>
              <th className="px-3 py-2 text-right">Time</th>
              <th className="px-5 py-2">Job / note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-5 py-2.5 font-medium">{e.full_name}</td>
                <td className="px-3 py-2.5 text-steel">{e.local_date}</td>
                <td className="px-3 py-2.5 tabular-nums">{e.in_time}</td>
                <td className="px-3 py-2.5 tabular-nums">{e.out_time ?? <span className="text-emerald-700">open</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {e.minutes != null ? formatDuration(e.minutes) : e.open_minutes != null ? `${formatDuration(e.open_minutes)}…` : ""}
                </td>
                <td className="px-5 py-2.5 text-steel">
                  {e.work_order_number && <Link href={`/app/orders/${e.work_order_id}`} className="underline">#{e.work_order_number}</Link>}{" "}
                  {e.note}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs hover:text-ink">Edit</summary>
                    <ActionForm action={saveTimeEntry} className="mt-2 flex flex-wrap items-end gap-2" keepAfterSuccess>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="employee_id" value={e.employee_id} />
                      <input type="date" name="date" defaultValue={e.local_date} aria-label="Date" className={input} />
                      <input type="time" name="in_time" defaultValue={e.in_time} aria-label="In" className={input} />
                      <input type="time" name="out_time" defaultValue={e.out_time ?? ""} aria-label="Out" className={input} />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="next_day" defaultChecked={!!e.out_date && e.out_date !== e.local_date} /> ends next day</label>
                      <input name="note" defaultValue={e.note ?? ""} placeholder="Note" aria-label="Note" className={`${input} w-40`} />
                      <button className={btnGhost}>Save</button>
                    </ActionForm>
                    <ActionForm action={deleteTimeEntry} className="mt-1">
                      <input type="hidden" name="id" value={e.id} />
                      <button className={`${btnDanger}`}>Delete entry</button>
                    </ActionForm>
                  </details>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-center text-steel">Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <details className={`${card} p-5`}>
        <summary className="cursor-pointer text-sm font-semibold">Add a missed entry</summary>
        <ActionForm action={saveTimeEntry} className="mt-4 flex flex-wrap items-end gap-3" keepAfterSuccess>
          <div>
            <label className={label} htmlFor="a-who">Person</label>
            <select id="a-who" name="employee_id" required className={input}>
              {staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="a-date">Date</label>
            <input id="a-date" type="date" name="date" defaultValue={ctx.today} required className={input} />
          </div>
          <div>
            <label className={label} htmlFor="a-in">In</label>
            <input id="a-in" type="time" name="in_time" defaultValue="08:00" required className={input} />
          </div>
          <div>
            <label className={label} htmlFor="a-out">Out</label>
            <input id="a-out" type="time" name="out_time" defaultValue="16:00" className={input} />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="next_day" /> ends next day</label>
          <div>
            <label className={label} htmlFor="a-note">Note</label>
            <input id="a-note" name="note" placeholder="e.g. forgot to clock in" className={`${input} w-56`} />
          </div>
          <button className={btn}>Add entry</button>
        </ActionForm>
        <p className="mt-2 text-xs text-steel">Every correction is recorded with who made it.</p>
      </details>
    </div>
  );
}

function TimesheetFilters({
  from, to, who, mode, staff,
}: {
  from: string; to: string; who?: string; mode: "hourly" | "flat" | "jobs";
  staff: { id: string; full_name: string }[];
}) {
  return (
    <form className="flex flex-wrap items-end gap-3">
      <div>
        <label className={label} htmlFor="mode">Pull</label>
        <select id="mode" name="mode" defaultValue={mode} className={input}>
          <option value="hourly">Shift hours (clocked)</option>
          <option value="jobs">Time on jobs (logged per job)</option>
          <option value="flat">Flat-rate hours (jobs completed)</option>
        </select>
      </div>
      <div>
        <label className={label} htmlFor="from">From</label>
        <input id="from" type="date" name="from" defaultValue={from} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="to">To (exclusive)</label>
        <input id="to" type="date" name="to" defaultValue={to} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="who">Person</label>
        <select id="who" name="who" defaultValue={who ?? ""} className={input}>
          <option value="">Everyone</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      </div>
      <button className={btn}>Show</button>
    </form>
  );
}
