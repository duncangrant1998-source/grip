import { requireSession } from "@/lib/auth";
import { tenantAddon } from "@/lib/addon-queries";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input, label } from "@/components/ui";
import { requestClientMessagingAddon } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  requested: { label: "Requested — waiting on Grip", tone: "bg-amber-50 text-amber-800" },
  active: { label: "Active", tone: "bg-emerald-50 text-emerald-700" },
  suspended: { label: "Suspended", tone: "bg-red-50 text-red-700" },
};

export default async function AddonsPage() {
  const session = await requireSession();
  const addon = await tenantAddon(session, "client_messaging");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Add-ons</h1>
        <p className="text-sm text-steel">Extra features billed on top of your plan.</p>
      </div>

      <section className={`${card} p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Client email &amp; text messaging</h2>
            <p className="mt-1 max-w-xl text-sm text-steel">
              Email or text a customer straight from an open work order — a status update, a
              quote approval, or letting them know their vehicle is ready.
            </p>
          </div>
          {addon && (
            <span className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${STATUS_COPY[addon.status].tone}`}>
              {STATUS_COPY[addon.status].label}
            </span>
          )}
        </div>

        {addon?.status === "active" && addon.granted_at && (
          <p className="mt-3 text-xs text-steel">Turned on {dateTime(addon.granted_at)}.</p>
        )}

        {addon?.status === "requested" && (
          <p className="mt-3 text-xs text-steel">
            Requested {addon.requested_at ? dateTime(addon.requested_at) : ""}. We'll follow up to set up
            billing and turn it on.
          </p>
        )}

        {addon?.status === "suspended" && (
          <p className="mt-3 text-xs text-red-700">
            This add-on is currently suspended. Contact Grip if you think that's wrong.
          </p>
        )}

        {(!addon || addon.status === "suspended") && (
          <ActionForm action={requestClientMessagingAddon} className="mt-4 space-y-2">
            <div>
              <label className={label} htmlFor="addon-note">Anything we should know? (optional)</label>
              <input id="addon-note" name="note" maxLength={500} className={`${input} w-full`}
                placeholder="e.g. how many texts a month you're expecting" />
            </div>
            <button className={btn}>Request this add-on</button>
          </ActionForm>
        )}

        {addon?.status === "requested" && (
          <ActionForm action={requestClientMessagingAddon} className="mt-3">
            <button className={btnGhost}>Send again</button>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
