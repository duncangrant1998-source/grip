import Link from "next/link";
import { requireDepartment } from "@/lib/auth";
import { listShifts, listStaff, listTimeOffBetween } from "@/lib/admin-queries";
import { getScheduleContext } from "@/lib/schedule-queries";
import {
  addDays, addMonths, formatDayName, formatMinutes, formatMonthDay, formatMonthYear, isDateString,
  startOfMonth, startOfWeek, weekDays,
} from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input, label } from "@/components/ui";
import { addShiftOnDay, addShifts, deleteShift } from "../actions";
import { ShiftCalendar } from "./ShiftCalendar";

export const dynamic = "force-dynamic";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; month?: string; start?: string; end?: string }>;
}) {
  const session = await requireDepartment("admin");
  const ctx = await getScheduleContext(session);
  const sp = await searchParams;
  const view = sp.view === "calendar" ? "calendar" : "week";

  const staff = await listStaff(session);
  const people = staff.filter((s) => s.is_active);

  // What a click on a day adds. Carried in the URL so it survives every click.
  const defStart = TIME.test(sp.start ?? "") ? sp.start! : "08:00";
  const defEnd = TIME.test(sp.end ?? "") && sp.end! > defStart ? sp.end! : "16:00";
  const hoursQs = `&start=${defStart}&end=${defEnd}`;

  const toggle = (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
      <Link
        href={`/app/admin/shifts?view=week${hoursQs}`}
        className={`rounded-md px-3 py-1.5 font-medium ${view === "week" ? "bg-white shadow-sm" : "text-steel hover:text-ink"}`}
      >
        Week grid
      </Link>
      <Link
        href={`/app/admin/shifts?view=calendar${hoursQs}`}
        className={`rounded-md px-3 py-1.5 font-medium ${view === "calendar" ? "bg-white shadow-sm" : "text-steel hover:text-ink"}`}
      >
        Calendar
      </Link>
    </div>
  );

  // --- Calendar: everyone, a month at a time ---------------------------------------------
  if (view === "calendar") {
    const shown = /^\d{4}-\d{2}$/.test(sp.month ?? "") && isDateString(`${sp.month}-01`)
      ? `${sp.month}-01` : startOfMonth(ctx.today);
    const gridStart = startOfWeek(shown);
    const gridEnd = addDays(startOfWeek(addDays(addMonths(shown, 1), -1)), 7);
    const [shifts, timeOff] = await Promise.all([
      listShifts(session, gridStart, gridEnd),
      listTimeOffBetween(session, gridStart, gridEnd),
    ]);
    const month = (m: string) => `/app/admin/shifts?view=calendar&month=${m.slice(0, 7)}${hoursQs}`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Shifts</h1>
            <p className="text-sm text-steel">{formatMonthYear(shown)} · everyone · times at the shop</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {toggle}
            <Link href={month(addMonths(shown, -1))} className={btnGhost} aria-label="Previous month">←</Link>
            <Link href={month(startOfMonth(ctx.today))} className={btnGhost}>This month</Link>
            <Link href={month(addMonths(shown, 1))} className={btnGhost} aria-label="Next month">→</Link>
          </div>
        </div>
        <ShiftCalendar month={shown} today={ctx.today} shifts={shifts} timeOff={timeOff} people={people} />
        <p className="text-xs text-steel">
          To change a day, click its date to open that week&apos;s grid, where a click on someone&apos;s day adds a shift.
        </p>
      </div>
    );
  }

  // --- Week grid: one row each, click a day to schedule them ------------------------------
  const weekStart = startOfWeek(isDateString(sp.week) ? sp.week : ctx.today);
  const days = weekDays(weekStart);
  const [shifts, timeOff] = await Promise.all([
    listShifts(session, weekStart, addDays(weekStart, 7)),
    listTimeOffBetween(session, weekStart, addDays(weekStart, 7)),
  ]);

  const cell = (empId: string, d: string) => shifts.filter((s) => s.employee_id === empId && s.local_date === d);
  const offOn = (empId: string, d: string) =>
    timeOff.find((r) => r.employee_id === empId && r.from_date <= d && d <= r.to_date);
  const hoursFor = (empId: string) =>
    shifts.filter((s) => s.employee_id === empId).reduce((a, s) => a + (s.end_min - s.start_min), 0) / 60;
  const week = (w: string) => `/app/admin/shifts?view=week&week=${w}${hoursQs}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Shifts</h1>
          <p className="text-sm text-steel">
            {formatMonthDay(weekStart)} – {formatMonthDay(addDays(weekStart, 6))} · times at the shop
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toggle}
          <Link href={week(addDays(weekStart, -7))} className={btnGhost}>← Previous</Link>
          <Link href={week(startOfWeek(ctx.today))} className={btnGhost}>This week</Link>
          <Link href={week(addDays(weekStart, 7))} className={btnGhost}>Next →</Link>
        </div>
      </div>

      {/* The hours a click adds. */}
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <input type="hidden" name="view" value="week" />
        <input type="hidden" name="week" value={weekStart} />
        <div className="text-sm">
          <span className="font-medium">Click a day to schedule someone</span>
          <span className="text-steel"> — each click adds a shift of</span>
        </div>
        <div>
          <label className={label} htmlFor="d-start">From</label>
          <input id="d-start" type="time" name="start" defaultValue={defStart} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="d-end">Until</label>
          <input id="d-end" type="time" name="end" defaultValue={defEnd} className={input} />
        </div>
        <button className={btnGhost}>Set hours</button>
      </form>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">Staff</th>
              {days.map((d) => (
                <th key={d} className={`px-2 py-3 ${d === ctx.today ? "text-shop" : ""}`}>
                  {formatDayName(d)} <span className="font-normal">{formatMonthDay(d)}</span>
                </th>
              ))}
              <th className="px-3 py-3 text-right">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-4 py-3 font-medium">
                  {p.full_name}
                  <div className="text-xs font-normal text-steel">{p.job_title}</div>
                </td>
                {days.map((d) => {
                  const here = cell(p.id, d);
                  const off = offOn(p.id, d);
                  return (
                    <td key={d} className={`px-2 py-2 ${d === ctx.today ? "bg-orange-50/50" : ""}`}>
                      {off && (
                        <div
                          title={off.status === "approved" ? "Approved time off" : "Time off requested, waiting for an answer"}
                          className={`mb-1 rounded px-1.5 py-1 text-[11px] font-medium ${
                            off.status === "approved"
                              ? "bg-slate-800 text-white"
                              : "border border-dashed border-amber-400 bg-amber-50 text-amber-900"
                          }`}
                        >
                          {off.status === "approved" ? "Time off" : "Time off — asked"}
                        </div>
                      )}
                      {here.map((s) => (
                        <div key={s.id} className="mb-1 flex items-center justify-between gap-1 rounded bg-blue-50 px-1.5 py-1 text-xs text-blue-900">
                          <span>{formatMinutes(s.start_min)}–{formatMinutes(s.end_min)}</span>
                          <ActionForm action={deleteShift}>
                            <input type="hidden" name="id" value={s.id} />
                            <button aria-label="Remove shift" className="text-blue-400 hover:text-red-600">×</button>
                          </ActionForm>
                        </div>
                      ))}
                      {/* One click: a shift for this person on this day. */}
                      <ActionForm action={addShiftOnDay}>
                        <input type="hidden" name="employee_id" value={p.id} />
                        <input type="hidden" name="date" value={d} />
                        <input type="hidden" name="start" value={defStart} />
                        <input type="hidden" name="end" value={defEnd} />
                        <button
                          aria-label={`Schedule ${p.full_name} on ${formatDayName(d)} ${formatMonthDay(d)}`}
                          title={`Add ${formatMinutes(Number(defStart.slice(0, 2)) * 60 + Number(defStart.slice(3)))}–${formatMinutes(Number(defEnd.slice(0, 2)) * 60 + Number(defEnd.slice(3)))}`}
                          className={`w-full rounded border border-dashed py-1 text-xs text-slate-300 transition hover:border-shop hover:bg-orange-50 hover:text-shop ${
                            here.length > 0 ? "border-transparent" : "border-slate-200"
                          }`}
                        >
                          +
                        </button>
                      </ActionForm>
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-right tabular-nums text-steel">{hoursFor(p.id) ? hoursFor(p.id).toFixed(1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">Schedule someone for several days</h2>
        <ActionForm action={addShifts} className="space-y-4" keepAfterSuccess>
          <input type="hidden" name="week_start" value={weekStart} />
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="emp">Who</label>
              <select id="emp" name="employee_id" required className={`${input} w-full`}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-1">
              <label className={label} htmlFor="st">From</label>
              <input id="st" type="time" name="start" defaultValue={defStart} required className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-1">
              <label className={label} htmlFor="en">Until</label>
              <input id="en" type="time" name="end" defaultValue={defEnd} required className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="nt">Note</label>
              <input id="nt" name="note" className={`${input} w-full`} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-steel">On these days this week</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {days.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5">
                  <input type="checkbox" name={`day_${i}`} defaultChecked={i < 5} />
                  {formatDayName(d)} {formatMonthDay(d)}
                </label>
              ))}
            </div>
          </fieldset>
          <button className={btn}>Add shifts</button>
        </ActionForm>
      </section>
    </div>
  );
}
