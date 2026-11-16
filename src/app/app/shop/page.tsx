import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/admin-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { saveDocuments, saveShopDetails } from "./actions";

export const dynamic = "force-dynamic";

export default async function ShopDetailsPage() {
  const session = await requireSession();
  const s = await getSettings(session);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{s.shop_name}</h1>
        <p className="text-sm text-steel">Who your shop is on every quote, invoice and receipt.</p>
      </div>

      {/* Shop details ---------------------------------------------------------------- */}
      <section className={`${card} p-5`}>
        <h2 className="mb-1 font-semibold">Shop details</h2>
        <p className="mb-4 text-xs text-steel">Printed at the top of quotes, invoices and receipts.</p>
        <ActionForm action={saveShopDetails} className="grid gap-3 sm:grid-cols-6" keepAfterSuccess>
          <div className="sm:col-span-6">
            <label className={label} htmlFor="legal">Business name</label>
            <input id="legal" name="legal_name" defaultValue={s.legal_name ?? s.shop_name} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-6">
            <label className={label} htmlFor="addr">Address</label>
            <input id="addr" name="address_line1" defaultValue={s.address_line1 ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="city">City</label>
            <input id="city" name="city" defaultValue={s.city ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="region">Province</label>
            <input id="region" name="region" defaultValue={s.region ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-1">
            <label className={label} htmlFor="postal">Postal code</label>
            <input id="postal" name="postal_code" defaultValue={s.postal_code ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-1">
            <label className={label} htmlFor="country">Country</label>
            <input id="country" name="country" maxLength={2} defaultValue={s.country} className={`${input} w-full uppercase`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="phone">Phone</label>
            <input id="phone" name="phone" defaultValue={s.phone ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={s.email ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-6">
            <label className={label} htmlFor="hstno">HST registration number</label>
            <input
              id="hstno" name="hst_number" defaultValue={s.hst_number ?? ""} placeholder="123456789RT0001"
              className={`${input} w-full font-mono uppercase sm:w-80`}
            />
            <p className="mt-1 text-xs text-steel">
              Your CRA business number. Printed on every quote, invoice and receipt, as the CRA requires once you&apos;re registered.
            </p>
          </div>
          <div className="sm:col-span-6"><button className={btn}>Save shop details</button></div>
        </ActionForm>
      </section>

      {/* Documents ------------------------------------------------------------------- */}
      <section className={`${card} p-5`}>
        <h2 className="mb-1 font-semibold">Quotes and invoices</h2>
        <p className="mb-4 text-xs text-steel">How your documents look to customers.</p>
        <ActionForm action={saveDocuments} className="space-y-3" keepAfterSuccess>
          <div>
            <label className={label} htmlFor="logo">Logo link</label>
            <input id="logo" name="logo_url" type="url" defaultValue={s.logo_url ?? ""} placeholder="https://…/logo.png" className={`${input} w-full`} />
            <p className="mt-1 text-xs text-steel">A link to an image already hosted online. Uploading a file directly is planned.</p>
          </div>
          {s.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.logo_url} alt="Logo preview" className="h-12 rounded border border-slate-200 bg-white p-1" />
          )}
          <div>
            <label className={label} htmlFor="footer">Footer</label>
            <textarea id="footer" name="invoice_footer" rows={3} defaultValue={s.invoice_footer ?? ""}
              placeholder="Warranty terms, payment details, thank-you note…" className={`${input} w-full`} />
          </div>
          <button className={btn}>Save</button>
        </ActionForm>
      </section>
    </div>
  );
}
