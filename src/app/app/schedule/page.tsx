import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getScheduleContext, listBays, listCalendar } from "@/lib/schedule-queries";
import {
  addDays, addMonths, daysBetween, formatLong, formatDayName, formatMonthDay, formatMonthYear,
  formatMinutes, isDateString, startOfMonth, startOfWeek, toTimeInput, weekDays,
} from "@/lib/dates";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ServiceNav } from "@/components/ServiceNav";
import { btn, btnGhost } from "@/components/ui";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid, type GridColumn, type GridItem } from "./TimeGrid";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "appointments.view")) redirect("/app?denied=the schedule");

  const sp = await searchParams;
  const ctx = await getScheduleContext(session);
  const view = sp.view === "week" ? "week" : sp.view === "month" ? "month" : "day";
  const date = isDateString(sp.date) ? sp.date : ctx.today;

  // A month view shows whole weeks, so it also covers the tail of the previous
  // month and the start of the next.
  const monthStart = startOfMonth(date);
  const monthGridStart = startOfWeek(monthStart);
  const monthGridEnd = addDays(startOfWeek(addDays(addMonths(date, 1), -1)), 7);

  const from = view === "month" ? monthGridStart : view === "week" ? startOfWeek(date) : date;
  const to = view === "month" ? monthGridEnd : addDays(from, view === "week" ? 7 : 1);

  const [items, bays] = await Promise.all([
    listCalendar(session, from, to),
    listBays(session),
  ]);

  const canEdit = can(session.role, "appointments.edit");
  const isTech = session.role === "technician";

  // Keep the grid tall enough that nothing booked outside normal hours disappears.
  const earliest = items.length ? Math.min(...items.map((i) => i.start_min)) : ctx.open_hour * 60;
  const latest = items.length ? Math.max(...items.map((i) => i.start_min + i.minutes)) : ctx.close_hour * 60;
  const openHour = Math.min(ctx.open_hour, Math.floor(earliest / 60));
  const closeHour = Math.min(24, Math.max(ctx.close_hour, Math.ceil(latest / 60)));

  let columns: GridColumn[] = [];
  let gridItems: GridItem[] = [];
  let slotHref: ((col: string, minute: number) => string) | undefined;
  let nowCols: string[] = [];

  if (view === "month") {
    // handled by MonthGrid below
  } else if (view === "day") {
    columns = bays.map((b) => ({
      key: b.id, label: b.name,
      sub: `${items.filter((i) => i.bay_id === b.id).length} booked`,
    }));
    // A bay retired since the appointment was made still needs a home on the grid.
    const known = new Set(bays.map((b) => b.id));
    for (const i of items) {
      if (i.bay_id && !known.has(i.bay_id)) {
        known.add(i.bay_id);
        columns.push({ key: i.bay_id, label: i.bay_name ?? "Bay", sub: "retired" });
      }
    }
    columns.push({ key: "none", label: "No bay", sub: "unassigned" });

    gridItems = items.map((i) => ({
      id: i.id,
      col: i.bay_id ?? "none",
      startMin: i.start_min,
      endMin: i.start_min + i.minutes,
      title: i.customer_name,
      subtitle: i.vehicle,
      detail: [i.tech_name, i.concern].filter(Boolean).join(" · "),
      status: i.status,
      href: `/app/schedule/${i.id}`,
    }));
    slotHref = (col, minute) =>
      `/app/schedule/new?date=${date}&time=${toTimeInput(minute)}${col !== "none" ? `&bay=${col}` : ""}`;
    nowCols = date === ctx.today ? columns.map((c) => c.key) : [];
  } else {
    const days = weekDays(date);
    columns = days.map((d) => ({
      key: d, label: `${formatDayName(d)} ${formatMonthDay(d)}`,
      sub: `${items.filter((i) => i.local_date === d).length} booked`,
      highlight: d === ctx.today,
    }));
    gridItems = items.map((i) => ({
      id: i.id,
      col: i.local_date,
      startMin: i.start_min,
      endMin: i.start_min + i.minutes,
      title: i.customer_name,
      subtitle: [i.vehicle, i.bay_name].filter(Boolean).join(" · "),
      detail: i.tech_name ?? undefined,
      status: i.status,
      href: `/app/schedule/${i.id}`,
    }));
    slotHref = (col, minute) => `/app/schedule/new?date=${col}&time=${toTimeInput(minute)}`;
    nowCols = [ctx.today];
  }

  const move = (n: number) =>
    view === "month" ? addMonths(date, n) : addDays(date, n * (view === "week" ? 7 : 1));
  const nav = (d: string, v = view) => `/app/schedule?view=${v}&date=${d}`;
  const heading = view === "month"
    ? formatMonthYear(monthStart)
    : view === "week"
      ? `${formatMonthDay(from)} – ${formatMonthDay(addDays(from, 6))}`
      : formatLong(date);

  return (
    <div className="space-y-5">
      <LiveRefresh everyMs={20000} />
      <ServiceNav role={session.role} active="schedule" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-steel">
            {heading}{date === ctx.today && view === "day" ? " · today" : ""}
            {isTech && " · your appointments"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {(["day", "week", "month"] as const).map((v) => (
              <Link key={v} href={nav(date, v)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize ${view === v ? "bg-white shadow-sm" : "text-steel hover:text-ink"}`}>
                {v}
              </Link>
            ))}
          </div>
          <Link href={nav(move(-1))} className={btnGhost} aria-label="Previous">←</Link>
          <Link href={nav(ctx.today)} className={btnGhost}>Today</Link>
          <Link href={nav(move(1))} className={btnGhost} aria-label="Next">→</Link>
          {canEdit && <Link href={`/app/schedule/new?date=${date}`} className={btn}>New appointment</Link>}
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid
          gridStart={monthGridStart}
          weeks={daysBetween(monthGridStart, monthGridEnd) / 7}
          month={monthStart.slice(0, 7)}
          today={ctx.today}
          items={items}
          canEdit={canEdit}
        />
      ) : (
        <TimeGrid
          columns={columns}
          items={gridItems}
          openHour={openHour}
          closeHour={closeHour}
          slotHref={canEdit ? slotHref : undefined}
          nowMin={ctx.now_min}
          nowCols={nowCols}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-steel">
        <div className="flex flex-wrap gap-3">
          {[
            ["Scheduled", "bg-slate-200"], ["Confirmed", "bg-blue-200"], ["Arrived", "bg-amber-200"],
            ["In progress", "bg-violet-200"], ["Completed", "bg-emerald-200"],
          ].map(([label, cls]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} /> {label}
            </span>
          ))}
          <span>
            Times shown in {ctx.timezone.replace("_", " ")}
            {view !== "month" && ` · ${formatMinutes(openHour * 60)}–${formatMinutes(closeHour * 60)}`}
          </span>
        </div>
        {can(session.role, "settings.manage") && (
          <Link href="/app/shop/bays" className="font-medium underline hover:text-ink">Manage bays</Link>
        )}
      </div>
    </div>
  );
}
