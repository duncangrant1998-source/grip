import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  listEntries, listMyTimeOff, listShifts, listTimeOffBetween, listTimeOffToAnswer,
  listJobTime, myClock, timeOffRecipients, type EntryRow,
} from "@/lib/admin-queries";
import { getScheduleContext } from "@/lib/schedule-queries";
import {
  addDays, addMonths, daysBetween, formatDuration, formatLong, formatMinutes,
  formatShort, isDateString, startOfMonth, startOfWeek,
} from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { btn, btnDanger, card, input, label } from "@/components/ui";
import { clockIn, clockOut, startJob, stopJob } from "./actions";
import { MyCalendar } from "./MyCalendar";
import { MyRequests, RequestForm, ToAnswer } from "./TimeOff";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "clock", label: "Clock" },
  { key: "schedule", label: "My schedule" },
  { key: "hours", label: "My hours" },
  { key: "timeoff", label: "Time off" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function TimeClockPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; from?: string; to?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "timeclock.own")) redirect("/app?denied=the time clock");

  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "clock") as Tab;

  const me = await myClock(session);
  if (!me) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-2xl font-bold">Time clock</h1>
        <p className={`${card} p-5 text-sm text-steel`}>
          Your login isn&apos;t linked to a staff record yet, so there&apos;s nothing to clock. Ask an
          administrator to add you under Administration → Staff.
        </p>
      </div>
    );
  }

  const ctx = await getScheduleContext(session);
  const isAdmin = can(session.role, "staff.manage");
  const toAnswer = await listTimeOffToAnswer(session, isAdmin);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <LiveRefresh everyMs={30000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Time clock</h1>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "clock" ? "/app/time" : `/app/time?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 font-medium ${
              tab === t.key ? "border-shop text-ink" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            {t.label}
            {t.key === "timeoff" && toAnswer.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {toAnswer.length}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {tab === "clock" && <ClockTab me={me} ctx={ctx} session={session} />}
      {tab === "schedule" && <ScheduleTab me={me} ctx={ctx} session={session} month={sp.month} />}
      {tab === "hours" && <HoursTab me={me} ctx={ctx} session={session} from={sp.from} to={sp.to} />}
      {tab === "timeoff" && <TimeOffTab me={me} ctx={ctx} session={session} toAnswer={toAnswer} />}
    </div>
  );
}

type Me = NonNullable<Awaited<ReturnType<typeof myClock>>>;
type Ctx = Awaited<ReturnType<typeof getScheduleContext>>;
type S = Awaited<ReturnType<typeof requireSession>>;

// --- Clock ------------------------------------------------------------------------

async function ClockTab({ me, ctx, session }: { me: Me; ctx: Ctx; session: S }) {
  const weekStart = startOfWeek(ctx.today);
  const [entries, shifts] = await Promise.all([
    listEntries(session, weekStart, addDays(weekStart, 7), me.employee.id),
    listShifts(session, ctx.today, addDays(ctx.today, 7), me.employee.id),
  ]);
  const { open } = me;

  return (
    <div className="space-y-6">
      {/* The shift: clocked in once a day, whoever you are. */}
      <section className={`${card} p-6`}>
        {open ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                On shift
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{formatDuration(open.minutes)}</div>
              <div className="text-sm text-steel">since {open.since_time}</div>
            </div>
            <ActionForm action={clockOut}>
              <button className={`${btnDanger} px-5 py-3 text-base`}>Clock out of shift</button>
            </ActionForm>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-steel">Not clocked in</div>
              <div className="text-lg font-semibold">{me.employee.full_name}</div>
              <div className="text-xs text-steel">Clock in for your day first; you can log time on jobs once you&apos;re on shift.</div>
            </div>
            <ActionForm action={clockIn}>
              <button className={`${btn} px-6 py-3 text-base`}>Clock in to shift</button>
            </ActionForm>
          </div>
        )}
      </section>

      {/* Time on a job: inside the shift, one job at a time. */}
      <section className={`${card} p-6`}>
        <h2 className="mb-1 font-semibold">Time on a job</h2>
        <p className="mb-4 text-xs text-steel">
          Log the time you spend on each work order, job to job. It shows the shop how long flat-rate work
          took on site and how many of your hours went into billable work. It runs inside your shift and
          stops when you clock out of it.
        </p>
        {me.job && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-sm">
              <div className="font-semibold text-emerald-900">
                On <Link href={`/app/orders/${me.job.work_order_id}`} className="underline">#{me.job.work_order_number}</Link>
                {" "}· {formatDuration(me.job.minutes)}
              </div>
              <div className="text-xs text-emerald-800">{me.job.customer}, {me.job.vehicle} · since {me.job.since_time}</div>
            </div>
            <ActionForm action={stopJob}>
              <button className={btnDanger}>Stop job</button>
            </ActionForm>
          </div>
        )}
        {open ? (
          <ActionForm action={startJob} className="flex flex-wrap items-end gap-3">
            <div className="min-w-72 flex-1">
              <label className={label} htmlFor="job-pick">{me.job ? "Move to another job" : "Start a job"}</label>
              <select id="job-pick" name="work_order_id" required defaultValue="" className={`${input} w-full`}>
                <option value="" disabled>Choose a work order…</option>
                {me.orders.filter((o) => o.id !== me.job?.work_order_id).map((o) => (
                  <option key={o.id} value={o.id}>#{o.number} — {o.customer}, {o.vehicle}</option>
                ))}
              </select>
            </div>
            <button className={btn}>{me.job ? "Switch job" : "Start job"}</button>
          </ActionForm>
        ) : (
          <p className="text-sm text-steel">Clock in to your shift to start logging job time.</p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className={`${card} p-5`}>
          <div className="text-xs text-steel">Today on shift</div>
          <div className="text-2xl font-bold tabular-nums">{me.today.toFixed(2)} h</div>
        </div>
        <div className={`${card} p-5`}>
          <div className="text-xs text-steel">Today on jobs</div>
          <div className="text-2xl font-bold tabular-nums">{me.jobToday.toFixed(2)} h</div>
        </div>
        <div className={`${card} p-5`}>
          <div className="text-xs text-steel">This week</div>
          <div className="text-2xl font-bold tabular-nums">{me.week.toFixed(2)} h</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Your next shifts</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {shifts.map((s) => (
              <li key={s.id} className="flex justify-between px-5 py-2.5">
                <span className="font-medium">{formatShort(s.local_date)}</span>
                <span className="text-steel">{formatMinutes(s.start_min)} – {formatMinutes(s.end_min)}</span>
              </li>
            ))}
            {shifts.length === 0 && <li className="px-5 py-6 text-center text-steel">Nothing scheduled in the next week.</li>}
          </ul>
          <div className="border-t border-slate-100 px-5 py-3 text-xs">
            <Link href="/app/time?tab=schedule" className="font-medium underline hover:text-ink">See the whole month</Link>
          </div>
        </section>

        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Your shifts this week</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-2.5">
                <span>
                  <span className="font-medium">{formatShort(e.local_date)}</span>{" "}
                  <span className="text-steel">{e.in_time} – {e.out_time ?? "now"}</span>
                  {e.work_order_number && <span className="text-steel"> · #{e.work_order_number}</span>}
                </span>
                <span className="tabular-nums text-steel">
                  {e.minutes != null ? formatDuration(e.minutes) : e.open_minutes != null ? `${formatDuration(e.open_minutes)}…` : ""}
                </span>
              </li>
            ))}
            {entries.length === 0 && <li className="px-5 py-6 text-center text-steel">Nothing yet this week.</li>}
          </ul>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-steel">
            Forgot to clock in or out? Ask an administrator to correct it — they&apos;re recorded with who changed what.
          </p>
        </section>
      </div>
    </div>
  );
}

// --- My schedule ---------------------------------------------------------------------

async function ScheduleTab({ me, ctx, session, month }: { me: Me; ctx: Ctx; session: S; month?: string }) {
  const shown = month && /^\d{4}-\d{2}$/.test(month) && isDateString(`${month}-01`) ? `${month}-01` : startOfMonth(ctx.today);
  const gridStart = startOfWeek(shown);
  const gridEnd = addDays(startOfWeek(addDays(addMonths(shown, 1), -1)), 7);

  const [shifts, timeOff] = await Promise.all([
    listShifts(session, gridStart, gridEnd, me.employee.id),
    listTimeOffBetween(session, gridStart, gridEnd, me.employee.id),
  ]);
  const next = shifts.find((s) => s.local_date >= ctx.today);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Your work schedule</h2>
        <p className="text-sm text-steel">
          {next
            ? <>Next shift: <span className="font-medium text-ink">{formatLong(next.local_date)}</span>, {formatMinutes(next.start_min)} – {formatMinutes(next.end_min)}.</>
            : "No shifts scheduled for the days shown."}
          {" "}Your administrator sets this; to change a day, ask for it under{" "}
          <Link href="/app/time?tab=timeoff" className="underline hover:text-ink">Time off</Link>.
        </p>
      </div>
      <MyCalendar
        month={shown} today={ctx.today} shifts={shifts} timeOff={timeOff}
        basePath="/app/time?tab=schedule"
      />
    </div>
  );
}

// --- My hours ---------------------------------------------------------------------------

function presets(today: string) {
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);
  const lastMonthStart = addMonths(monthStart, -1);
  return [
    { label: "Today", from: today, to: today },
    { label: "This week", from: weekStart, to: addDays(weekStart, 6) },
    { label: "Last week", from: addDays(weekStart, -7), to: addDays(weekStart, -1) },
    { label: "Last 14 days", from: addDays(today, -13), to: today },
    { label: "This month", from: monthStart, to: addDays(addMonths(monthStart, 1), -1) },
    { label: "Last month", from: lastMonthStart, to: addDays(monthStart, -1) },
  ];
}

async function HoursTab({
  me, ctx, session, from, to,
}: { me: Me; ctx: Ctx; session: S; from?: string; to?: string }) {
  const quick = presets(ctx.today);
  let start = isDateString(from) ? from : quick[1].from;
  let end = isDateString(to) ? to : isDateString(from) ? from : quick[1].to;
  if (end < start) [start, end] = [end, start];
  // A year is more than anyone needs to page through, and keeps the query bounded.
  const tooLong = daysBetween(start, end) > 366;
  if (tooLong) end = addDays(start, 366);

  const [entries, jobRows] = await Promise.all([
    listEntries(session, start, addDays(end, 1), me.employee.id),
    listJobTime(session, start, addDays(end, 1), me.employee.id),
  ]);
  const minutesOf = (e: EntryRow) => e.minutes ?? e.open_minutes ?? 0;

  const byDay = new Map<string, EntryRow[]>();
  for (const e of [...entries].reverse()) byDay.set(e.local_date, [...(byDay.get(e.local_date) ?? []), e]);

  const total = entries.reduce((n, e) => n + minutesOf(e), 0);
  const onJobs = jobRows.reduce((n, j) => n + j.minutes, 0);
  const hourly = Math.max(0, total - onJobs);
  const h = (m: number) => (m / 60).toFixed(2);
  const sameDay = start === end;

  return (
    <div className="space-y-5">
      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">Look up your hours</h2>
        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="hours" />
          <div>
            <label className={label} htmlFor="h-from">From</label>
            <input id="h-from" type="date" name="from" defaultValue={start} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="h-to">To</label>
            <input id="h-to" type="date" name="to" defaultValue={end} className={input} />
          </div>
          <button className={btn}>Show hours</button>
          <span className="pb-2 text-xs text-steel">Leave &ldquo;To&rdquo; the same as &ldquo;From&rdquo; for a single day.</span>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {quick.map((p) => (
            <Link
              key={p.label}
              href={`/app/time?tab=hours&from=${p.from}&to=${p.to}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                p.from === start && p.to === end ? "border-shop bg-orange-50" : "border-slate-200 bg-white text-steel hover:text-ink"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </section>

      {tooLong && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          That&apos;s more than a year, so it&apos;s been cut to a year from the first date.
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-steel">
          {sameDay ? formatLong(start) : `${formatShort(start)} – ${formatShort(end)}`}
        </h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className={`${card} p-4`}>
            <div className="text-xs text-steel">Shift hours</div>
            <div className="text-2xl font-bold tabular-nums">{h(total)}</div>
          </div>
          <div className={`${card} p-4`}>
            <div className="text-xs text-steel">Days worked</div>
            <div className="text-2xl font-bold tabular-nums">{byDay.size}</div>
          </div>
          <div className={`${card} p-4`}>
            <div className="text-xs text-steel">On jobs</div>
            <div className="text-2xl font-bold tabular-nums">{h(onJobs)}</div>
          </div>
          <div className={`${card} p-4`}>
            <div className="text-xs text-steel">Not on a job</div>
            <div className="text-2xl font-bold tabular-nums">{h(hourly)}</div>
          </div>
        </div>
      </div>

      <section className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2.5">Day</th>
              <th className="px-3 py-2.5">Clocked</th>
              <th className="px-3 py-2.5 text-right">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...byDay.entries()].map(([day, list]) => (
              <tr key={day} className="align-top">
                <td className="px-5 py-3 font-medium">{formatShort(day)}</td>
                <td className="px-3 py-3 text-steel">
                  {list.map((e) => (
                    <div key={e.id}>
                      {e.in_time} – {e.out_time ?? "now"}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums">
                  {h(list.reduce((n, e) => n + minutesOf(e), 0))}
                </td>
              </tr>
            ))}
            {byDay.size === 0 && (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-steel">No time clocked in that period.</td></tr>
            )}
          </tbody>
          {byDay.size > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-5 py-3" colSpan={2}>Total</td>
                <td className="px-3 py-3 text-right tabular-nums">{h(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <section className={`${card} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Time on jobs</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {jobRows.map((j) => (
            <li key={j.id} className="flex items-center justify-between px-5 py-2.5">
              <span>
                <span className="font-medium">{formatShort(j.local_date)}</span>{" "}
                <span className="text-steel">{j.in_time} – {j.out_time ?? "now"}</span>{" "}
                <Link href={`/app/orders/${j.work_order_id}`} className="underline">#{j.work_order_number}</Link>{" "}
                <span className="text-steel">{j.customer}, {j.vehicle}</span>
              </span>
              <span className="tabular-nums text-steel">{formatDuration(j.minutes)}</span>
            </li>
          ))}
          {jobRows.length === 0 && <li className="px-5 py-6 text-center text-steel">No job time logged in that period.</li>}
        </ul>
      </section>
    </div>
  );
}

// --- Time off -----------------------------------------------------------------------------

async function TimeOffTab({
  me, ctx, session, toAnswer,
}: { me: Me; ctx: Ctx; session: S; toAnswer: Awaited<ReturnType<typeof listTimeOffToAnswer>> }) {
  const [mine, recipients] = await Promise.all([
    listMyTimeOff(session, me.employee.id),
    timeOffRecipients(session),
  ]);

  return (
    <div className="space-y-6">
      <ToAnswer rows={toAnswer} showTo />
      <RequestForm recipients={recipients} today={ctx.today} />
      <MyRequests rows={mine} />
      <p className="text-xs text-steel">
        Approved time off shows on your{" "}
        <Link href="/app/time?tab=schedule" className="underline hover:text-ink">schedule</Link>.
      </p>
    </div>
  );
}
