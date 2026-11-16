"use client";

import { useState } from "react";
import { input, label } from "@/components/ui";

/**
 * The supplier dropdown, with a way out of it: pick "Add a new supplier…" and
 * its details appear in place, so a part can be entered without first leaving to
 * create the supplier somewhere else. The form posts the sentinel `__new__` as
 * the supplier and the new supplier's fields alongside it.
 */
export function SupplierSelect({
  suppliers, defaultValue = "",
}: {
  suppliers: { id: string; name: string }[];
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const adding = value === "__new__";

  return (
    <>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="supplier_id">Supplier</label>
        <select
          id="supplier_id" name="supplier_id" value={value}
          onChange={(e) => setValue(e.target.value)} className={`${input} w-full`}
        >
          <option value="">None</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__new__">＋ Add a new supplier…</option>
        </select>
      </div>

      {adding && (
        <div className="grid gap-3 rounded-md border border-dashed border-slate-300 p-3 sm:col-span-6 sm:grid-cols-12">
          <div className="text-xs font-medium text-steel sm:col-span-12">
            New supplier — add the address, hours and delivery details later on the Suppliers page.
          </div>
          <div className="sm:col-span-4">
            <label className={label} htmlFor="ns-name">Name</label>
            <input id="ns-name" name="new_supplier_name" required className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="ns-phone">Phone</label>
            <input id="ns-phone" name="new_supplier_phone" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="ns-email">Email</label>
            <input id="ns-email" name="new_supplier_email" type="email" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="ns-lead">Lead days</label>
            <input id="ns-lead" name="new_supplier_lead" inputMode="numeric" defaultValue={2} className={`${input} w-full`} />
          </div>
        </div>
      )}
    </>
  );
}
