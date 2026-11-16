import Link from "next/link";
import type { ShiftRow, TimeOffRow } from "@/lib/admin-queries";
import {
  addDays, addMonths, daysBetween, formatMinutes, formatMonthYear, startOfMonth, startOfWeek, weekdayIndex,
} from "@/lib/dates";
import { btnGhost } from "@/components/ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * One person's month: the days they are scheduled to work and the hours, with
 * time off painted over it. Approved time off is solid, a request still waiting
 * is dashed, so it is clear which days are actually settled.
 */
export function MyCalendar({
  month, today, shifts, timeOff, basePath,
}: {
  month: string;          // any date inside the month being shown
  today: string;
  shifts: ShiftRow[];
  timeOff: TimeOffRow[];
  basePath: string;       // e.g. /app/time?tab=schedule
}) {
  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart);
  const lastDay = addDays(addMonths(monthStart, 1), -1);
  const gridEnd = addDays(startOfWeek(lastDay), 7);
  const dayCount = daysBetween(gridStart, gridEnd);
  const days = Array.from({ length: dayCount }, (_, i) => addDays(gridStart, i));

  const shiftsBy = new Map<string, ShiftRow[]>();
  for (const s of shifts) shiftsBy.set(s.local_date, [...(shiftsBy.get(s.local_date) ?? []), s]);

  const offOn = (d: string) => timeOff.find((r) => r.from_date <= d && d <= r.to_date);

  const link = (m: string) => `${basePath}${basePath.includes("?") ? "&" : "?"}month=${m.slice(0, 7)}`;
  const thisMonth = startOfMonth(today);

  const worked = days.filter((d) => d.startsWith(monthStart.slice(0, 7)) && shiftsBy.has(d) && !offOn(d)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{formatMonthYear(monthStart)}</h2>
          <p className="text-xs text-steel">
            {worked} day{worked === 1 ? "" : "s"} scheduled this month
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={link(addMonths(monthStart, -1))} className={btnGhost} aria-label="Previous month">←</Link>
          <Link href={link(thisMonth)} className={btnGhost}>This month</Link>
          <Link href={link(addMonths(monthStart, 1))} className={btnGhost} aria-label="Next month">→</Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid min-w-[44rem] grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-steel">
          {WEEKDAYS.map((d) => <div key={d} className="px-3 py-2">{d}</div>)}
        </div>
        <div className="grid min-w-[44rem] grid-cols-7">
          {days.map((d) => {
            const inMonth = d.startsWith(monthStart.slice(0, 7));
            const isToday = d === today;
            const off = offOn(d);
            const shiftList = shiftsBy.get(d) ?? [];
            return (
              <div
                key={d}
                className={`min-h-24 border-b border-r border-slate-100 p-1.5 ${
                  isToday ? "bg-orange-50" : !inMonth ? "bg-slate-50 text-slate-400" : weekdayIndex(d) >= 5 ? "bg-slate-50/60" : ""
                }`}
              >
                <div className={`px-1 text-sm font-semibold ${isToday ? "text-shop" : ""}`}>{Number(d.slice(8))}</div>
                <div className="mt-1 space-y-1">
                  {off ? (
                    <div className={`rounded px-1.5 py-1 text-[11px] font-medium leading-tight ${
                      off.status === "approved"
                        ? "bg-slate-800 text-white"
                        : "border border-dashed border-amber-400 bg-amber-50 text-amber-900"
                    }`}>
                      {off.status === "approved" ? "Time off" : "Time off — asked"}
                    </div>
                  ) : null}
                  {shiftList.map((s) => (
                    <div
                      key={s.id}
                      className={`rounded border px-1.5 py-1 text-[11px] leading-tight ${
                        off ? "border-slate-200 text-slate-400 line-through" : "border-emerald-300 bg-emerald-50 text-emerald-900"
                      }`}
                    >
                      <span className="font-semibold">{formatMinutes(s.start_min)}</span>
                      {" – "}{formatMinutes(s.end_min)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-steel">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-300" /> Scheduled to work</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-800" /> Time off (approved)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-amber-400 bg-amber-50" /> Time off (waiting for an answer)</span>
      </div>
    </div>
  );
}
