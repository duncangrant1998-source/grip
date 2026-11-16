import { ActionForm } from "@/components/ActionForm";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import type { TimeOffRow } from "@/lib/admin-queries";
import { dateTime } from "@/lib/format";
import { formatMonthDay } from "@/lib/dates";
import { cancelTimeOff, decideTimeOff, requestTimeOff } from "./actions";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800",
  approved: "bg-emerald-50 text-emerald-700",
  declined: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

export function whenText(r: Pick<TimeOffRow, "from_date" | "to_date" | "days">) {
  return r.from_date === r.to_date
    ? formatMonthDay(r.from_date)
    : `${formatMonthDay(r.from_date)} – ${formatMonthDay(r.to_date)} (${r.days} days)`;
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status] ?? ""}`}>
      {status === "cancelled" ? "withdrawn" : status}
    </span>
  );
}

/** The form a member of staff fills in to ask for days off. */
export function RequestForm({
  recipients, today,
}: {
  recipients: { id: string; full_name: string; role: string }[];
  today: string;
}) {
  return (
    <ActionForm action={requestTimeOff} className={`${card} grid gap-3 p-5 sm:grid-cols-12`}>
      <h2 className="font-semibold sm:col-span-12">Ask for time off</h2>
      <div className="sm:col-span-3">
        <label className={label} htmlFor="to-from">First day</label>
        <input id="to-from" type="date" name="from" required min={today} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor="to-to">Last day</label>
        <input id="to-to" type="date" name="to" required min={today} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-6">
        <label className={label} htmlFor="to-recipient">Send to</label>
        <select id="to-recipient" name="recipient" className={`${input} w-full`} defaultValue="">
          <option value="">The shop administrator</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}{r.role === "shop_admin" ? " (administrator)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-12">
        <label className={label} htmlFor="to-note">Message</label>
        <textarea
          id="to-note" name="note" rows={3} maxLength={1000} className={`${input} w-full`}
          placeholder="Anything they should know — why, whether it's flexible, who could cover."
        />
      </div>
      <div className="sm:col-span-12"><button className={btn}>Send request</button></div>
    </ActionForm>
  );
}

/** A person's own requests, with a way to withdraw one that is still waiting. */
export function MyRequests({ rows }: { rows: TimeOffRow[] }) {
  return (
    <section className={`${card} overflow-hidden`}>
      <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Your requests</h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{whenText(r)}</span>
                <StatusPill status={r.status} />
              </div>
              <div className="text-xs text-steel">
                Sent to {r.recipient_name ?? "an administrator"} · {dateTime(r.created_at)}
              </div>
              {r.note && <p className="mt-1 text-steel">&ldquo;{r.note}&rdquo;</p>}
              {r.decided_by_name && (
                <p className="mt-1 text-xs">
                  <span className="font-medium">{r.decided_by_name}</span>{" "}
                  {r.status === "approved" ? "approved it" : "declined it"}
                  {r.decision_note && <span className="text-steel"> — &ldquo;{r.decision_note}&rdquo;</span>}
                </p>
              )}
            </div>
            {r.status === "pending" && (
              <ActionForm action={cancelTimeOff}>
                <input type="hidden" name="id" value={r.id} />
                <button className={btnDanger}>Withdraw</button>
              </ActionForm>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-5 py-6 text-center text-steel">You haven&apos;t asked for any time off.</li>}
      </ul>
    </section>
  );
}

/** Requests waiting for this person to answer, each with a reply box and two buttons. */
export function ToAnswer({ rows, showTo = false }: { rows: TimeOffRow[]; showTo?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section className={`${card} overflow-hidden border-amber-200`}>
      <h2 className="border-b border-amber-100 bg-amber-50 px-5 py-3 font-semibold text-amber-900">
        {rows.length} time-off request{rows.length === 1 ? "" : "s"} waiting for your answer
      </h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold">{r.full_name}</span>
              <span>{whenText(r)}</span>
              {showTo && r.recipient_name && (
                <span className="text-xs text-steel">sent to {r.recipient_name}</span>
              )}
            </div>
            {r.note && <p className="mt-1 text-steel">&ldquo;{r.note}&rdquo;</p>}
            <ActionForm action={decideTimeOff} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={r.id} />
              <div className="min-w-64 flex-1">
                <label className={label} htmlFor={`reply-${r.id}`}>Reply (optional)</label>
                <input id={`reply-${r.id}`} name="reply" maxLength={1000} className={`${input} w-full`} />
              </div>
              <button name="decision" value="approve" className={btn}>Approve</button>
              <button name="decision" value="decline" className={btnGhost}>Decline</button>
            </ActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}
