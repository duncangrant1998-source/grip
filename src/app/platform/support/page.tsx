import { requirePlatformAdmin } from "@/lib/auth";
import { listSupportRequests, listSupportAccessGrants } from "@/lib/platform-queries";
import { card, btnGhost } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { setSupportRequestStatus, operatorRevokeAccess } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-50 text-amber-800",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

export default async function SupportPage() {
  const session = await requirePlatformAdmin();
  const requests = await listSupportRequests(session);
  const open = requests.filter((r) => r.status !== "resolved");
  const resolved = requests.filter((r) => r.status === "resolved");

  const grants = await listSupportAccessGrants(session);
  const activeGrants = grants.filter((g) => !g.revoked_at && new Date(g.expires_at) > new Date());

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-semibold">Shops with access open right now</h2>
        {activeGrants.length === 0 ? (
          <p className={`${card} px-5 py-4 text-sm text-steel`}>
            No shop has opened its data to you right now — you only see each shop's account,
            activity and billing, not its customers, work orders or staff, unless it grants access.
          </p>
        ) : (
          activeGrants.map((g) => (
            <div key={g.id} className={`${card} flex items-center justify-between p-4 text-sm`}>
              <div>
                <span className="font-semibold">{g.shop_name}</span>
                <span className="ml-2 text-steel">
                  open until {dateTime(g.expires_at)}{g.note ? ` — ${g.note}` : ""}
                </span>
              </div>
              <ActionForm action={operatorRevokeAccess}>
                <input type="hidden" name="id" value={g.id} />
                <ConfirmButton
                  label="Close access"
                  title="Close this shop's access grant?"
                  message="You'll lose visibility into this shop's customers, work orders and staff until they grant access again."
                  confirmLabel="Close access"
                  className={btnGhost}
                />
              </ActionForm>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Open</h2>
        {open.length === 0 && (
          <p className={`${card} px-5 py-4 text-sm text-steel`}>Nothing waiting on you.</p>
        )}
        {open.map((r) => <RequestCard key={r.id} r={r} />)}
      </section>

      {resolved.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-steel">Resolved</h2>
          {resolved.map((r) => <RequestCard key={r.id} r={r} />)}
        </section>
      )}
    </div>
  );
}

function RequestCard({ r }: { r: Awaited<ReturnType<typeof listSupportRequests>>[number] }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{r.shop_name}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>
              {r.status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-0.5 text-sm font-medium">{r.subject}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-steel">{r.message}</p>
          <div className="mt-2 text-xs text-steel">
            {r.created_by_name ?? "Someone"} · {dateTime(r.created_at)}
            {r.resolved_at && <> · resolved by {r.resolved_by_name ?? "you"}, {dateTime(r.resolved_at)}</>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {r.status !== "in_progress" && r.status !== "resolved" && (
            <StatusButton id={r.id} status="in_progress" label="Start" />
          )}
          {r.status !== "resolved" && <StatusButton id={r.id} status="resolved" label="Resolve" />}
          {r.status === "resolved" && <StatusButton id={r.id} status="open" label="Reopen" />}
        </div>
      </div>
    </div>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={setSupportRequestStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={btnGhost}>{label}</button>
    </ActionForm>
  );
}
