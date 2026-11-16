import Link from "next/link";
import type { ShiftRow, TimeOffRow } from "@/lib/admin-queries";
import {
  addDays, addMonths, daysBetween, formatMinutes, startOfMonth, startOfWeek, weekdayIndex,
} from "@/lib/dates";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 6;

// Enough distinct, readable colours that neighbours on the calendar rarely match.
const PALETTE = [
  "border-blue-200 bg-blue-50 text-blue-900",
  "border-emerald-200 bg-emerald-50 text-emerald-900",
  "border-violet-200 bg-violet-50 text-violet-900",
  "border-amber-200 bg-amber-50 text-amber-900",
  "border-rose-200 bg-rose-50 text-rose-900",
  "border-cyan-200 bg-cyan-50 text-cyan-900",
  "border-lime-200 bg-lime-50 text-lime-900",
  "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900",
];

/**
 * Everyone's month at once: who works which day, and when. A person keeps the
 * same colour all month, approved time off is struck through in grey, and a
 * crowded day collapses to "+N more" with a way into that week's grid.
 */
export function ShiftCalendar({
  month, today, shifts, timeOff, people,
}: {
  month: string;
  today: string;
  shifts: ShiftRow[];
  timeOff: TimeOffRow[];
  people: { id: string; full_name: string }[];
}) {
  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart);
  const lastDay = addDays(addMonths(monthStart, 1), -1);
  const gridEnd = addDays(startOfWeek(lastDay), 7);
  const days = Array.from({ length: daysBetween(gridStart, gridEnd) }, (_, i) => addDays(gridStart, i));

  const colour = new Map(people.map((p, i) => [p.id, PALETTE[i % PALETTE.length]]));
  const first = (name: string) => name.split(" ")[0];

  const shiftsBy = new Map<string, ShiftRow[]>();
  for (const s of shifts) shiftsBy.set(s.local_date, [...(shiftsBy.get(s.local_date) ?? []), s]);
  const offOn = (empId: string, d: string) =>
    timeOff.some((r) => r.employee_id === empId && r.status === "approved" && r.from_date <= d && d <= r.to_date);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid min-w-[56rem] grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-steel">
          {WEEKDAYS.map((d) => <div key={d} className="px-3 py-2">{d}</div>)}
        </div>
        <div className="grid min-w-[56rem] grid-cols-7">
          {days.map((d) => {
            const inMonth = d.startsWith(monthStart.slice(0, 7));
            const list = shiftsBy.get(d) ?? [];
            const isToday = d === today;
            return (
              <div
                key={d}
                className={`min-h-32 border-b border-r border-slate-100 p-1.5 ${
                  isToday ? "bg-orange-50" : !inMonth ? "bg-slate-50 text-slate-400" : weekdayIndex(d) >= 5 ? "bg-slate-50/60" : ""
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <Link
                    href={`/app/admin/shifts?week=${startOfWeek(d)}`}
                    className={`text-sm font-semibold hover:underline ${isToday ? "text-shop" : ""}`}
                    title="Open this week to edit"
                  >
                    {Number(d.slice(8))}
                  </Link>
                  {list.length > 0 && <span className="text-[11px] text-steel">{list.length} working</span>}
                </div>
                <div className="space-y-1">
                  {list.slice(0, SHOWN).map((s) => {
                    const off = offOn(s.employee_id, d);
                    return (
                      <div
                        key={s.id}
                        title={`${s.full_name}: ${formatMinutes(s.start_min)} – ${formatMinutes(s.end_min)}${off ? " (approved time off)" : ""}`}
                        className={`truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight ${
                          off ? "border-slate-200 bg-white text-slate-400 line-through" : colour.get(s.employee_id) ?? PALETTE[0]
                        }`}
                      >
                        <span className="font-semibold">{first(s.full_name)}</span>{" "}
                        {formatMinutes(s.start_min).replace(":00", "")}–{formatMinutes(s.end_min).replace(":00", "")}
                      </div>
                    );
                  })}
                  {list.length > SHOWN && (
                    <Link
                      href={`/app/admin/shifts?week=${startOfWeek(d)}`}
                      className="block px-1 text-[11px] font-medium text-steel hover:text-ink"
                    >
                      +{list.length - SHOWN} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-steel">
        {people.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${colour.get(p.id)}`} />
            {p.full_name}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-slate-200 bg-white" />
          <span className="line-through">Approved time off</span>
        </span>
      </div>
    </div>
  );
}
