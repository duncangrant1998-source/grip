import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listCoworkers, listThreads } from "@/lib/messaging-queries";
import { ROLE_LABELS } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { card, btn, input, label } from "@/components/ui";
import { sendNewMessage } from "./actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const session = await requireSession();
  const [threads, coworkers] = await Promise.all([listThreads(session), listCoworkers(session)]);
  const alreadyMessaged = new Set(threads.map((t) => t.other_id));
  const newRecipients = coworkers.filter((c) => !alreadyMessaged.has(c.id));

  return (
    <div className="space-y-5">
      <LiveRefresh everyMs={8000} />
      <div>
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="max-w-3xl text-sm text-steel">Message anyone else at the shop directly.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={`${card} overflow-hidden`}>
          {threads.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-steel">
              No conversations yet — start one with the form on the right.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {threads.map((t) => (
                <Link key={t.id} href={`/app/messages/${t.id}`} className="block px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${t.unread ? "" : "text-steel"}`}>{t.other_name}</span>
                        <span className="text-xs text-steel">{ROLE_LABELS[t.other_role]}</span>
                        {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label="Unread" />}
                      </div>
                      {t.last_message_body && (
                        <p className={`truncate text-sm ${t.unread ? "font-medium" : "text-steel"}`}>
                          {t.last_message_sender_id === session.userId ? "You: " : ""}
                          {t.last_message_body}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-steel">{dateTime(t.last_message_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <section className={`${card} h-fit p-5`}>
          <h2 className="mb-3 font-semibold">New message</h2>
          {coworkers.length === 0 ? (
            <p className="text-sm text-steel">No other active coworkers at this shop yet.</p>
          ) : (
            <ActionForm action={sendNewMessage} className="space-y-3">
              <div>
                <label className={label} htmlFor="msg-recipient">To</label>
                <select id="msg-recipient" name="recipient_id" required className={`${input} w-full`} defaultValue="">
                  <option value="" disabled>Choose a coworker…</option>
                  {newRecipients.length > 0 && (
                    <optgroup label="Start a new conversation">
                      {newRecipients.map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name} — {ROLE_LABELS[c.role]}</option>
                      ))}
                    </optgroup>
                  )}
                  {alreadyMessaged.size > 0 && (
                    <optgroup label="Message again">
                      {coworkers.filter((c) => alreadyMessaged.has(c.id)).map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name} — {ROLE_LABELS[c.role]}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="msg-body">Message</label>
                <textarea id="msg-body" name="body" required maxLength={4000} rows={4}
                  className={`${input} w-full`} placeholder="Say something…" />
              </div>
              <button className={btn}>Send</button>
            </ActionForm>
          )}
        </section>
      </div>
    </div>
  );
}
