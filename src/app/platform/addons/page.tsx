import { requirePlatformAdmin } from "@/lib/auth";
import { listAddonRequests, listTenantsWithoutAddon } from "@/lib/addon-queries";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, btnDanger, card, input, label } from "@/components/ui";
import { setAddonStatus } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-amber-50 text-amber-800",
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-red-50 text-red-700",
};

/**
 * Client email/SMS messaging is the first (and so far only) shop_addons key.
 * This page is deliberately not about billing — recording payment for it
 * runs through the existing /platform/payments flow like anything else. This
 * is only: who's asked for it, and whose switch is currently on.
 */
export default async function PlatformAddonsPage() {
  const session = await requirePlatformAdmin();
  const [rows, withoutAddon] = await Promise.all([
    listAddonRequests(session, "client_messaging"),
    listTenantsWithoutAddon(session, "client_messaging"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Client email &amp; text messaging</h1>
        <p className="text-sm text-steel">
          Turn this on once a shop's billing for it is sorted out. No provider (Resend/Twilio) has
          to be configured for a specific shop — one set of credentials in the environment covers
          everyone with it active; see .env.example.
        </p>
      </div>

      <section className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-2">Shop</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Requested</th>
              <th className="px-4 py-2">Note</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.tenant_id}>
                <td className="px-4 py-3 font-medium">{r.shop_name}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-steel">{r.requested_at ? dateTime(r.requested_at) : "—"}</td>
                <td className="px-4 py-3 text-steel">{r.note ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  {r.status !== "active" && (
                    <ActionForm action={setAddonStatus} className="inline">
                      <input type="hidden" name="tenant_id" value={r.tenant_id} />
                      <input type="hidden" name="status" value="active" />
                      <button className={`${btn} px-3 py-1.5 text-xs`}>Turn on</button>
                    </ActionForm>
                  )}
                  {r.status === "active" && (
                    <ActionForm action={setAddonStatus} className="inline">
                      <input type="hidden" name="tenant_id" value={r.tenant_id} />
                      <input type="hidden" name="status" value="suspended" />
                      <button className={btnDanger}>Suspend</button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-steel">No shop has asked for this yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {withoutAddon.length > 0 && (
        <section className={`${card} p-5`}>
          <h2 className="mb-3 font-semibold">Turn it on for a shop that hasn't asked</h2>
          <ActionForm action={setAddonStatus} className="flex items-end gap-2">
            <div className="flex-1">
              <label className={label} htmlFor="grant-tenant">Shop</label>
              <select id="grant-tenant" name="tenant_id" required className={`${input} w-full`}>
                {withoutAddon.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <input type="hidden" name="status" value="active" />
            <button className={btnGhost}>Turn on</button>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
