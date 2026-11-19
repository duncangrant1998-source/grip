import { can } from "@/lib/permissions";
import type { Session } from "@/lib/session";
import { addonIsActive, listClientMessages } from "@/lib/addon-queries";
import { ActionForm } from "@/components/ActionForm";
import { dateTime } from "@/lib/format";
import { btn, card, input, label } from "@/components/ui";
import { sendClientMessage } from "../actions";

const STATUS_STYLE: Record<string, string> = {
  sent: "text-emerald-700",
  queued: "text-steel",
  failed: "text-red-700",
};

/**
 * Email/text the customer about this order — the client-messaging add-on.
 * Self-contained like CustomerPanel: it decides its own visibility rather
 * than the page working it out, so the gating lives in one place.
 *
 * Only shows up when all three are true: this role may send client
 * messages at all (permissions.ts), the shop has actually turned the
 * add-on on (not just requested it), and the order is open — approved,
 * in_progress or completed, the same bucket the orders list calls "open".
 * A quote has nothing to tell a customer yet; a closed order is done.
 */
export async function ClientMessagingPanel({
  session, workOrderId, orderStatus, customerEmail, customerPhone,
}: {
  session: Session;
  workOrderId: string;
  orderStatus: string;
  customerEmail: string | null;
  customerPhone: string | null;
}) {
  if (!can(session.role, "clientMessaging.send", session.extraRoles)) return null;
  if (!["approved", "in_progress", "completed"].includes(orderStatus)) return null;
  if (!(await addonIsActive(session, "client_messaging"))) return null;

  const messages = await listClientMessages(session, workOrderId);

  return (
    <section className={`${card} p-5`}>
      <h2 className="mb-1 font-semibold">Message the customer</h2>
      <p className="mb-4 text-xs text-steel">Sends an email or text about this specific order.</p>

      <ActionForm action={sendClientMessage} className="space-y-3">
        <input type="hidden" name="work_order_id" value={workOrderId} />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="channel" value="email" defaultChecked={!!customerEmail} disabled={!customerEmail} />
            Email {!customerEmail && <span className="text-xs text-steel">(no email on file)</span>}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="channel" value="sms" defaultChecked={!customerEmail && !!customerPhone} disabled={!customerPhone} />
            Text {!customerPhone && <span className="text-xs text-steel">(no phone on file)</span>}
          </label>
        </div>
        <div>
          <label className={label} htmlFor="cm-body">Message</label>
          <textarea id="cm-body" name="body" required maxLength={1600} rows={3}
            className={`${input} w-full`} placeholder="Your car is ready for pickup…" />
        </div>
        <button className={btn} disabled={!customerEmail && !customerPhone}>Send</button>
      </ActionForm>

      {messages.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          {messages.map((m) => (
            <div key={m.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium uppercase text-xs text-steel">{m.channel}</span>
                <span className={`text-xs font-medium ${STATUS_STYLE[m.status]}`}>
                  {m.status === "failed" ? `Not sent — ${m.failure_reason ?? "unknown reason"}` : m.status}
                </span>
                <span className="text-xs text-steel">{dateTime(m.created_at)} · {m.sent_by_name ?? "—"}</span>
              </div>
              <p className="text-steel">{m.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
