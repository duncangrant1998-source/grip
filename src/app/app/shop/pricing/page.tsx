import { requireSession } from "@/lib/auth";
import { getSettings, getTaxSetup } from "@/lib/admin-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { saveLabour, saveTax } from "../actions";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await requireSession();
  const [s, tax] = await Promise.all([getSettings(session), getTaxSetup(session)]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Labour and tax</h1>
        <p className="text-sm text-steel">What a new job is priced and taxed at before anyone edits it.</p>
      </div>

      {/* Labour ---------------------------------------------------------------------- */}
      <section className={`${card} p-5`}>
        <h2 className="mb-1 font-semibold">Labour</h2>
        <p className="mb-4 text-xs text-steel">
          Defaults for new work orders. You can still change either on any single work order or line.
        </p>
        <ActionForm action={saveLabour} className="space-y-4" keepAfterSuccess>
          <div className="w-48">
            <label className={label} htmlFor="lr">Labour rate per hour</label>
            <input id="lr" name="default_labour_rate" inputMode="decimal" defaultValue={s.default_labour_rate} className={`${input} w-full`} />
          </div>
          <fieldset>
            <legend className={label}>Customers are charged by</legend>
            <div className="space-y-2">
              {([
                ["flat_rate", "Flat rate (book time)", "Charge the hours you quote, whatever the job really takes."],
                ["straight_time", "Straight time", "Charge the hours actually worked."],
              ] as const).map(([v, title, blurb]) => (
                <label key={v} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 px-3 py-2.5 text-sm has-[:checked]:border-shop has-[:checked]:bg-orange-50">
                  <input type="radio" name="labour_billing_mode" value={v} defaultChecked={s.labour_billing_mode === v} className="mt-1" />
                  <span><span className="font-medium">{title}</span><br /><span className="text-xs text-steel">{blurb}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className={btn}>Save labour settings</button>
        </ActionForm>
      </section>

      {/* Tax --------------------------------------------------------------------------- */}
      <section className={`${card} p-5`}>
        <h2 className="mb-1 font-semibold">Tax</h2>
        <p className="mb-4 text-xs text-steel">
          Grip charges Ontario HST on labour and parts. Changing the rate here never alters invoices
          already issued — they keep the tax that was charged at the time.
        </p>

        <ActionForm action={saveTax} className="space-y-4" keepAfterSuccess>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="hst">HST rate</label>
              <div className="relative">
                <input
                  id="hst" name="hst_pct" inputMode="decimal" required
                  defaultValue={tax.hst_bps != null ? String(tax.hst_bps / 100) : "13"}
                  className={`${input} w-full pr-7 text-right`}
                />
                <span className="pointer-events-none absolute right-2.5 top-2 text-sm text-steel">%</span>
              </div>
              <p className="mt-1 text-xs text-steel">Ontario is 13%.</p>
            </div>
            <p className="text-xs text-steel sm:col-span-4 sm:self-end">
              Your HST registration number is set under Shop details and printed on every quote and invoice.
            </p>
          </div>
          <button className={btn}>Save tax settings</button>
        </ActionForm>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="font-medium">Exempt</div>
          <p className="text-xs text-steel">
            Every shop also has an <strong>Exempt</strong> option that charges nothing. Set it on a
            customer so all their work is exempt, or on a single quote or invoice. An exempt invoice
            can&apos;t be issued until a reason is recorded against it.
          </p>
          {!tax.exempt_exists && (
            <p className="mt-2 text-xs text-red-700">
              This shop has no exempt option. Contact support — it should always be there.
            </p>
          )}
        </div>

        {tax.retired > 0 && (
          <p className="mt-3 text-xs text-steel">
            {tax.retired === 1 ? "One older tax rate was" : `${tax.retired} older tax rates were`} retired when
            Grip moved to Ontario HST. Documents that used {tax.retired === 1 ? "it" : "them"} are unchanged.
          </p>
        )}
      </section>
    </div>
  );
}
