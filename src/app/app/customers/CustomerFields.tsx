"use client";

import { useState } from "react";
import { EXEMPT_REASON_LABELS, EXEMPT_REFERENCE_LABELS, exemptNeedsReference } from "@/lib/format";
import { input, label } from "@/components/ui";

type Defaults = {
  display_name?: string; phone?: string | null; email?: string | null;
  address_line1?: string | null; city?: string | null; region?: string | null;
  postal_code?: string | null; notes?: string | null; tax_rate_id?: string | null;
  exempt_reason?: string | null; exempt_reference?: string | null;
  exempt_expires_on?: string | null;
};

export function CustomerFields({
  defaults = {},
  taxRates,
}: {
  defaults?: Defaults;
  taxRates: { id: string; name: string }[];
}) {
  const [reason, setReason] = useState(defaults.exempt_reason ?? "");
  const refRequired = reason !== "" && exemptNeedsReference(reason);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={label} htmlFor="display_name">Name or company</label>
        <input id="display_name" name="display_name" required defaultValue={defaults.display_name} className={`${input} w-full`} />
      </div>
      <div>
        <label className={label} htmlFor="phone">Phone</label>
        <input id="phone" name="phone" defaultValue={defaults.phone ?? ""} className={`${input} w-full`} />
      </div>
      <div>
        <label className={label} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" defaultValue={defaults.email ?? ""} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="address_line1">Address</label>
        <input id="address_line1" name="address_line1" defaultValue={defaults.address_line1 ?? ""} className={`${input} w-full`} />
      </div>
      <div>
        <label className={label} htmlFor="city">City</label>
        <input id="city" name="city" defaultValue={defaults.city ?? ""} className={`${input} w-full`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="region">Province / state</label>
          <input id="region" name="region" defaultValue={defaults.region ?? ""} className={`${input} w-full`} />
        </div>
        <div>
          <label className={label} htmlFor="postal_code">Postal code</label>
          <input id="postal_code" name="postal_code" defaultValue={defaults.postal_code ?? ""} className={`${input} w-full`} />
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="tax_rate_id">Always charge this customer</label>
        <select id="tax_rate_id" name="tax_rate_id" defaultValue={defaults.tax_rate_id ?? ""} className={`${input} w-full`}>
          <option value="">Shop default tax rate</option>
          {taxRates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-steel">For fleet or tax-exempt accounts. Overrides the shop default on new work orders.</p>
      </div>

      {/* An exemption the shop can stand behind if the CRA asks about it. */}
      <fieldset className="rounded-md border border-slate-200 p-3 sm:col-span-2">
        <legend className="px-1 text-xs font-medium text-steel">If this customer is exempt</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="exempt_reason">Reason</label>
            <select
              id="exempt_reason" name="exempt_reason" value={reason}
              onChange={(e) => setReason(e.target.value)} className={`${input} w-full`}
            >
              <option value="">Not exempt</option>
              {Object.entries(EXEMPT_REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="exempt_reference">
              {EXEMPT_REFERENCE_LABELS[reason] ?? "Reference"}
              {refRequired && <span className="text-red-600"> *</span>}
            </label>
            <input
              id="exempt_reference" name="exempt_reference" maxLength={60}
              defaultValue={defaults.exempt_reference ?? ""} required={refRequired}
              disabled={reason === ""} className={`${input} w-full`}
            />
          </div>
          <div>
            <label className={label} htmlFor="exempt_expires_on">Expires</label>
            <input
              id="exempt_expires_on" name="exempt_expires_on" type="date"
              defaultValue={defaults.exempt_expires_on ?? ""} disabled={reason === ""}
              className={`${input} w-full`}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-steel">
          Printed on every exempt invoice. Once the expiry passes, new work is taxed again
          until the renewal is recorded.
        </p>
      </fieldset>

      <div className="sm:col-span-2">
        <label className={label} htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes ?? ""} className={`${input} w-full`} />
      </div>
    </div>
  );
}
