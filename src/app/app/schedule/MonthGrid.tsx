import Link from "next/link";
import { addDays, formatMinutes, weekdayIndex } from "@/lib/dates";
import type { CalendarItem } from "@/lib/schedule-queries";

const STATUS_STYLE: Record<string, string> = {
  scheduled: "border-slate-300 bg-slate-100 text-slate-800",
  confirmed: "border-blue-300 bg-blue-50 text-blue-900",
  arrived: "border-amber-300 bg-amber-50 text-amber-900",
  in_progress: "border-violet-300 bg-violet-50 text-violet-900",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-900 opacity-70",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 4;

/**
 * A month at a glance: one cell per day, each listing that day's appointments.
 * Clicking a day opens the day view; a long day shows "+N more".
 */
export function MonthGrid({
  gridStart, weeks, month, today, items, canEdit,
}: {
  gridStart: string;
  weeks: number;
  month: string; // YYYY-MM, the month being viewed
  today: string;
  items: CalendarItem[];
  canEdit: boolean;
}) {
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of items) {
    const list = byDay.get(i.local_date) ?? [];
    list.push(i);
    byDay.set(i.local_date, list);
  }

  const days = Array.from({ length: weeks * 7 }, (_, n) => addDays(gridStart, n));

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-w-[56rem] grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-steel">
        {WEEKDAYS.map((d) => <div key={d} className="px-3 py-2">{d}</div>)}
      </div>
      <div className="grid min-w-[56rem] grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          const isToday = d === today;
          const weekend = weekdayIndex(d) >= 5;
          return (
            <div
              key={d}
              className={`min-h-32 border-b border-r border-slate-100 p-1.5 ${
                isToday ? "bg-orange-50" : inMonth ? (weekend ? "bg-slate-50/60" : "") : "bg-slate-50 text-slate-400"
              }`}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <Link
                  href={`/app/schedule?view=day&date=${d}`}
                  className={`text-sm font-semibold hover:underline ${isToday ? "text-shop" : ""}`}
                >
                  {Number(d.slice(8))}
                </Link>
                {list.length > 0 && <span className="text-[11px] text-steel">{list.length} booked</span>}
                {canEdit && list.length === 0 && inMonth && (
                  <Link href={`/app/schedule/new?date=${d}`} className="text-[11px] text-slate-300 hover:text-ink" aria-label={`New appointment on ${d}`}>+</Link>
                )}
              </div>
              <div className="space-y-1">
                {list.slice(0, SHOWN).map((i) => (
                  <Link
                    key={i.id}
                    href={`/app/schedule/${i.id}`}
                    className={`block truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:brightness-95 ${STATUS_STYLE[i.status] ?? STATUS_STYLE.scheduled}`}
                    title={`${formatMinutes(i.start_min)} · ${i.customer_name} · ${i.vehicle}`}
                  >
                    <span className="font-semibold">{formatMinutes(i.start_min)}</span> {i.customer_name}
                  </Link>
                ))}
                {list.length > SHOWN && (
                  <Link href={`/app/schedule?view=day&date=${d}`} className="block px-1.5 text-[11px] font-medium text-steel hover:text-ink">
                    +{list.length - SHOWN} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
