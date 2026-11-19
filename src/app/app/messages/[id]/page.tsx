import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { threadParticipant, threadMessages } from "@/lib/messaging-queries";
import { ROLE_LABELS } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { card, btn, input } from "@/components/ui";
import { sendReply, markThreadRead } from "../actions";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  // RLS confines both queries to a thread the caller is actually on; a
  // stranger's or another shop's thread id just comes back empty.
  const other = await threadParticipant(session, id);
  if (!other) notFound();

  const messages = await threadMessages(session, id);

  // Opening the thread is what "reading" it means here. Idempotent, so it's
  // safe to run on every render (including React's dev double-render).
  await markThreadRead(id);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <LiveRefresh everyMs={5000} />
      <div className="flex items-center gap-3">
        <Link href="/app/messages" className="text-sm text-steel hover:underline">← Messages</Link>
        <div>
          <h1 className="text-lg font-bold">{other.other_name}</h1>
          <p className="text-xs text-steel">{ROLE_LABELS[other.other_role]}</p>
        </div>
      </div>

      <div className={`${card} flex max-h-[60vh] min-h-[16rem] flex-col gap-3 overflow-y-auto p-4`}>
        {messages.length === 0 && (
          <p className="my-auto text-center text-sm text-steel">
            No messages yet. Say hi to {other.other_name.split(" ")[0]}.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === session.userId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-ink text-white" : "bg-slate-100"}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-1 text-[10px] ${mine ? "text-white/60" : "text-steel"}`}>{dateTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>

      <ActionForm action={sendReply} className="flex items-end gap-2" keepAfterSuccess={false}>
        <input type="hidden" name="recipient_id" value={other.other_id} />
        <input type="hidden" name="thread_id" value={id} />
        <textarea
          name="body" required maxLength={4000} rows={2} autoFocus
          placeholder={`Message ${other.other_name.split(" ")[0]}…`}
          className={`${input} w-full resize-none`}
        />
        <button className={btn}>Send</button>
      </ActionForm>
    </div>
  );
}
