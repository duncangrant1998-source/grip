import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listTechnicians } from "@/lib/queries";
import { getAppointment, listBays } from "@/lib/schedule-queries";
import { formatDuration, formatLong, formatMinutes } from "@/lib/dates";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { btn, btnDanger, btnGhost, card } from "@/components/ui";
import { convertToWorkOrder, setAppointmentStatus, updateAppointment } from "../actions";
import { AppointmentFields } from "../AppointmentFields";
import { describeAppointmentAudit } from "../audit";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled", confirmed: "Confirmed", arrived: "Arrived",
  in_progress: "In progress", completed: "Completed", no_show: "No-show", cancelled: "Cancelled",
};
const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-700", confirmed: "bg-blue-50 text-blue-700",
  arrived: "bg-amber-50 text-amber-800", in_progress: "bg-violet-50 text-violet-700",
  completed: "bg-emerald-50 text-emerald-700", no_show: "bg-red-50 text-red-700",
  cancelled: "bg-red-50 text-red-700",
};

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const data = await getAppointment(session, id);
  if (!data) notFound();
  const { appt, audit } = data;

  const canEdit = can(session.role, "appointments.edit", session.extraRoles);
  const live = ["scheduled", "confirmed", "arrived"].includes(appt.status);
  const mayChange = canEdit && live;
  const mayConvert = can(session.role, "workorders.create", session.extraRoles) && !appt.work_order_id &&
    ["scheduled", "confirmed", "arrived", "in_progress"].includes(appt.status);

  const [bays, techs] = mayChange
    ? await Promise.all([listBays(session), listTechnicians(session)])
    : [[], []];

  const step = (to: string, label: string, danger = false) => (
    <ActionForm action={setAppointmentStatus}>
      <input type="hidden" name="id" value={appt.id} />
      <input type="hidden" name="to" value={to} />
      <button className={danger ? btnDanger : btnGhost}>{label}</button>
    </ActionForm>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <LiveRefresh everyMs={15000} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/app/schedule?date=${appt.local_date}`} className="text-sm text-steel hover:text-ink">← Schedule</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold">{appt.customer_name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[appt.status]}`}>
              {STATUS_LABEL[appt.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-steel">
            {appt.vehicle}{appt.plate && ` · ${appt.plate}`}
            {appt.customer_phone && ` · ${appt.customer_phone}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {appt.work_order_id && (
            <Link href={`/app/orders/${appt.work_order_id}`} className={btn}>
              Open work order #{appt.work_order_number}
            </Link>
          )}
          {mayConvert && (
            <ActionForm action={convertToWorkOrder}>
              <input type="hidden" name="id" value={appt.id} />
              <button className={btn}>Create work order</button>
            </ActionForm>
          )}
        </div>
      </div>

      <section className={`${card} grid gap-4 p-5 text-sm sm:grid-cols-3`}>
        <div>
          <div className="text-xs text-steel">When</div>
          <div className="font-semibold">{formatLong(appt.local_date)}</div>
          <div>{formatMinutes(appt.start_min)} – {formatMinutes(appt.end_min)} <span className="text-steel">({formatDuration(appt.minutes)})</span></div>
        </div>
        <div>
          <div className="text-xs text-steel">Bay</div>
          <div className="font-semibold">{appt.bay_name ?? "Not assigned"}</div>
        </div>
        <div>
          <div className="text-xs text-steel">Technician</div>
          <div className="font-semibold">{appt.tech_name ?? "Not assigned"}</div>
        </div>
        {appt.concern && (
          <div className="sm:col-span-3">
            <div className="text-xs text-steel">Reason for visit</div>
            <div>{appt.concern}</div>
          </div>
        )}
      </section>

      {mayChange && (
        <div className="flex flex-wrap gap-2">
          {appt.status === "scheduled" && step("confirmed", "Mark confirmed")}
          {(appt.status === "scheduled" || appt.status === "confirmed") && step("arrived", "Customer arrived")}
          {(appt.status === "scheduled" || appt.status === "confirmed") && step("no_show", "No-show", true)}
          {step("cancelled", "Cancel appointment", true)}
        </div>
      )}

      {mayChange && (
        <details className={`${card} p-5`}>
          <summary className="cursor-pointer text-sm font-semibold">Reschedule or change details</summary>
          <ActionForm action={updateAppointment} className="mt-4 space-y-4" keepAfterSuccess>
            <input type="hidden" name="id" value={appt.id} />
            <AppointmentFields
              defaults={{
                date: appt.local_date, time: appt.start_time, minutes: appt.minutes,
                bay_id: appt.bay_id, tech_id: appt.tech_id, concern: appt.concern,
              }}
              bays={bays} techs={techs}
            />
            <button className={btn}>Save changes</button>
          </ActionForm>
        </details>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Activity</h2>
        <ol className={`${card} divide-y divide-slate-100 text-sm`}>
          {audit.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
              <span>
                <span className="font-medium">{a.actor ?? "System"}</span>{" "}
                <span className="text-steel">{describeAppointmentAudit(a.action, a.diff)}</span>
              </span>
              <span className="shrink-0 text-xs text-steel">{dateTime(a.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
