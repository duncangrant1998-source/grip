import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { listOwnSupportRequests } from "@/lib/platform-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { changePassword, submitSupportRequest } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-50 text-amber-800",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

export default async function AccountPage() {
  const session = await requireSession();
  const myRequests = await listOwnSupportRequests(session);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="text-sm text-steel">
          {session.fullName} · {session.isPlatformAdmin ? "Platform operator" : ROLE_LABELS[session.role]}
        </p>
      </div>

      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">Change password</h2>
        <ActionForm action={changePassword} className="space-y-3">
          <div>
            <label className={label} htmlFor="cur">Current password</label>
            <input id="cur" name="current" type="password" autoComplete="current-password" required className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="new">New password</label>
            <input id="new" name="next" type="password" autoComplete="new-password" required minLength={8} className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="conf">Confirm new password</label>
            <input id="conf" name="confirm" type="password" autoComplete="new-password" required minLength={8} className={`${input} w-full`} />
          </div>
          <button className={btn}>Change password</button>
          <p className="text-xs text-steel">You&apos;ll be signed out everywhere and asked to sign in again.</p>
        </ActionForm>
      </section>

      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">Contact support</h2>
        <ActionForm action={submitSupportRequest} className="space-y-3">
          <div>
            <label className={label} htmlFor="subject">Subject</label>
            <input id="subject" name="subject" type="text" required maxLength={120} className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="message">What's going on?</label>
            <textarea id="message" name="message" required maxLength={4000} rows={4} className={`${input} w-full`} />
          </div>
          <button className={btn}>Send</button>
        </ActionForm>

        {myRequests.length > 0 && (
          <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
            {myRequests.map((r) => (
              <div key={r.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.subject}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>
                    {r.status.replace("_", " ")}
                  </span>
                </div>
                <div className="text-xs text-steel">Sent {dateTime(r.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
