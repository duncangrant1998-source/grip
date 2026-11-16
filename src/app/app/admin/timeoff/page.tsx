import { requireDepartment } from "@/lib/auth";
import { listAllTimeOff, listTimeOffToAnswer } from "@/lib/admin-queries";
import { card } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { StatusPill, ToAnswer, whenText } from "../../time/TimeOff";

export const dynamic = "force-dynamic";

/**
 * Every time-off request in the shop. An administrator can answer any of them,
 * whoever it was addressed to — the person it was sent to is shown so it is
 * clear when someone else is expecting to deal with it.
 */
export default async function AdminTimeOffPage() {
  const session = await requireDepartment("admin");
  const [all, waiting] = await Promise.all([
    listAllTimeOff(session),
    listTimeOffToAnswer(session, true),
  ]);
  const rest = all.filter((r) => r.status !== "pending");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Time off</h1>
        <p className="text-sm text-steel">Requests from your staff, and how each was answered.</p>
      </div>

      <ToAnswer rows={waiting} showTo />
      {waiting.length === 0 && (
        <p className={`${card} px-5 py-4 text-sm text-steel`}>Nothing is waiting for an answer.</p>
      )}

      <section className={`${card} overflow-hidden`}>
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">History</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-5 py-2">Who</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Answered by</th>
              <th className="px-5 py-2">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rest.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-5 py-3 font-medium">{r.full_name}</td>
                <td className="px-3 py-3 whitespace-nowrap">{whenText(r)}</td>
                <td className="px-3 py-3"><StatusPill status={r.status} /></td>
                <td className="px-3 py-3 text-steel">
                  {r.decided_by_name ?? "—"}
                  {r.decided_at && <div className="text-xs">{dateTime(r.decided_at)}</div>}
                </td>
                <td className="px-5 py-3 text-steel">
                  {r.note && <div>&ldquo;{r.note}&rdquo;</div>}
                  {r.decision_note && <div className="text-xs">Reply: &ldquo;{r.decision_note}&rdquo;</div>}
                </td>
              </tr>
            ))}
            {rest.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-steel">No answered requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
