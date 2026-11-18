import { requireSession } from "@/lib/auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { listOwnSupportRequests, listSupportAccessGrants } from "@/lib/platform-queries";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { btn, card, input, label } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { changePassword, submitSupportRequest, grantAccess, revokeAccess } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-50 text-amber-800",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

export default async function AccountPage() {
  const session = await requireSession();
  const myRequests = await listOwnSupportRequests(session);
  const canManageAccess = can(session.role, "supportAccess.manage");
  const grants = canManageAccess ? await listSupportAccessGrants(session) : [];
  const activeGrant = grants.find((g) => !g.revoked_at && new Date(g.expires_at) > new Date());

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

      {canManageAccess && (
        <section className={`${card} p-5`}>
          <h2 className="mb-1 font-semibold">GRIP support access</h2>
          <p className="mb-3 text-xs text-steel">
            By default GRIP support can&apos;t see this shop&apos;s customers, work orders or
            staff — only that this shop exists and roughly how active it is. If you need
            help diagnosing something, open access for a limited window; it closes itself
            when the window ends, or you can close it early.
          </p>

          {activeGrant ? (
            <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>Open until {dateTime(activeGrant.expires_at)}{activeGrant.note ? ` — ${activeGrant.note}` : ""}</span>
              <ActionForm action={revokeAccess}>
                <input type="hidden" name="id" value={activeGrant.id} />
                <ConfirmButton
                  label="Close now"
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  title="Close support access?"
                  message="GRIP support will no longer be able to see this shop's data."
                  confirmLabel="Close access"
                  tone="danger"
                />
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={grantAccess} className="flex flex-wrap items-end gap-3">
              <div>
                <label className={label} htmlFor="hours">Open access for</label>
                <select id="hours" name="hours" defaultValue="24" className={`${input}`}>
                  <option value="4">4 hours</option>
                  <option value="24">24 hours</option>
                  <option value="48">48 hours</option>
                  <option value="168">1 week</option>
                </select>
              </div>
              <div className="flex-1">
                <label className={label} htmlFor="note">Note (optional)</label>
                <input id="note" name="note" type="text" maxLength={300} placeholder="e.g. ticket about missing invoice totals" className={`${input} w-full`} />
              </div>
              <button className={btn}>Open access</button>
            </ActionForm>
          )}

          {grants.length > 0 && (
            <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-steel">
              {grants.slice(0, 5).map((g) => (
                <div key={g.id}>
                  {dateTime(g.created_at)} — {g.granted_by_name ?? "someone"} opened access until{" "}
                  {dateTime(g.expires_at)}{g.revoked_at ? `, closed ${dateTime(g.revoked_at)}` : ""}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
