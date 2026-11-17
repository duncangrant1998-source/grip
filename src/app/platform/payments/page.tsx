import { requirePlatformAdmin } from "@/lib/auth";
import { listPayments, listTenantOptions, paymentSummary } from "@/lib/platform-queries";
import { card, btn, btnGhost, input, label } from "@/components/ui";
import { money, dateOnly, dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { recordPayment, updatePaymentStatus } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700",
  due: "bg-slate-100 text-slate-700",
  overdue: "bg-red-50 text-red-700",
  waived: "bg-amber-50 text-amber-800",
};

export default async function PaymentsPage() {
  const session = await requirePlatformAdmin();
  const [payments, tenants, summary] = await Promise.all([
    listPayments(session),
    listTenantOptions(session),
    paymentSummary(session),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <SummaryTile label="Due" value={String(summary.due)} tone={summary.due > 0 ? "text-ink" : "text-steel"} />
        <SummaryTile label="Overdue" value={String(summary.overdue)} tone={summary.overdue > 0 ? "text-red-700" : "text-steel"} />
        <SummaryTile label="Paid, last 30 days" value={money(summary.paid_last_30d)} tone="text-emerald-700" />
      </div>

      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">Record a payment</h2>
        <ActionForm action={recordPayment} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={label} htmlFor="tenant_id">Shop</label>
            <select id="tenant_id" name="tenant_id" required className={`${input} w-full`}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="amount">Amount (CAD)</label>
            <input id="amount" name="amount" type="number" step="0.01" min="0" required className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue="due" className={`${input} w-full`}>
              <option value="due">Due</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="waived">Waived</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="period_start">Period start</label>
            <input id="period_start" name="period_start" type="date" className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="period_end">Period end</label>
            <input id="period_end" name="period_end" type="date" className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="due_date">Due date</label>
            <input id="due_date" name="due_date" type="date" className={`${input} w-full`} />
          </div>
          <div className="col-span-2 sm:col-span-3">
            <label className={label} htmlFor="note">Note</label>
            <input id="note" name="note" type="text" maxLength={500} className={`${input} w-full`} />
          </div>
          <div className="col-span-2 sm:col-span-3">
            <button className={btn}>Record payment</button>
          </div>
        </ActionForm>
      </section>

      <section className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-2">Shop</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Period</th>
              <th className="px-4 py-2">Due</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Note</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-4 py-3 font-medium">{p.shop_name}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(p.amount)}</td>
                <td className="px-4 py-3 text-steel">
                  {p.period_start && p.period_end
                    ? `${dateOnly(p.period_start)} – ${dateOnly(p.period_end)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-steel">{p.due_date ? dateOnly(p.due_date) : "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[p.status]}`}>
                    {p.status}
                  </span>
                  {p.paid_at && <div className="mt-0.5 text-[11px] text-steel">{dateTime(p.paid_at)}</div>}
                </td>
                <td className="px-4 py-3 text-steel">{p.note ?? "—"}</td>
                <td className="px-4 py-3">
                  {p.status !== "paid" && <QuickStatus id={p.id} status="paid" label="Mark paid" />}
                  {p.status === "due" && <QuickStatus id={p.id} status="overdue" label="Mark overdue" />}
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-steel">No payments recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SummaryTile({ label: title, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`${card} p-4`}>
      <div className="text-xs uppercase tracking-wide text-steel">{title}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function QuickStatus({ id, status, label: text }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={updatePaymentStatus} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`${btnGhost} mr-1.5`}>{text}</button>
    </ActionForm>
  );
}
