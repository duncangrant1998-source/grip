import Link from "next/link";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listSuppliers, type SupplierRow } from "@/lib/parts-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { createSupplier, updateSupplier } from "../actions";

export const dynamic = "force-dynamic";

/** The fields a supplier has, shared by "add" and "edit". */
function SupplierFields({ s, prefix }: { s?: SupplierRow; prefix: string }) {
  const id = (n: string) => `${prefix}-${n}`;
  return (
    <div className="grid gap-3 sm:grid-cols-12">
      <div className="sm:col-span-5">
        <label className={label} htmlFor={id("name")}>Name</label>
        <input id={id("name")} name="name" required defaultValue={s?.name} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor={id("acct")}>Account no.</label>
        <input id={id("acct")} name="account_no" defaultValue={s?.account_no ?? ""} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("phone")}>Phone</label>
        <input id={id("phone")} name="phone" defaultValue={s?.phone ?? ""} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("email")}>Email</label>
        <input id={id("email")} name="email" type="email" defaultValue={s?.email ?? ""} className={`${input} w-full`} />
      </div>

      <div className="sm:col-span-5">
        <label className={label} htmlFor={id("addr")}>Address</label>
        <input id={id("addr")} name="address_line1" defaultValue={s?.address_line1 ?? ""} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor={id("city")}>City</label>
        <input id={id("city")} name="city" defaultValue={s?.city ?? ""} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("region")}>Province</label>
        <input id={id("region")} name="region" defaultValue={s?.region ?? "ON"} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("postal")}>Postal code</label>
        <input id={id("postal")} name="postal_code" defaultValue={s?.postal_code ?? ""} className={`${input} w-full`} />
      </div>

      <div className="sm:col-span-6">
        <label className={label} htmlFor={id("hours")}>Hours of operation</label>
        <input
          id={id("hours")} name="hours" defaultValue={s?.hours ?? ""} maxLength={300}
          placeholder="e.g. Mon–Fri 7:30–5:00, Sat 8:00–12:00, closed Sunday" className={`${input} w-full`}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("lead")}>Lead time (days)</label>
        <input id={id("lead")} name="lead_time_days" inputMode="numeric" defaultValue={s?.lead_time_days ?? 2} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-12">
        <label className={label} htmlFor={id("delivery")}>Delivery</label>
        <textarea
          id={id("delivery")} name="delivery_notes" rows={2} defaultValue={s?.delivery_notes ?? ""} maxLength={1000}
          placeholder="e.g. Same-day if ordered before 10 a.m. Two truck runs a day, 11:00 and 3:30. Free delivery over $150."
          className={`${input} w-full`}
        />
      </div>
    </div>
  );
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const session = await requireDepartment("parts");
  const { panel } = await searchParams;
  const suppliers = await listSuppliers(session);
  const canEdit = can(session.role, "purchaseOrders.manage", session.extraRoles);
  const adding = canEdit && (panel === "add" || suppliers.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Suppliers</h1>
        {canEdit && suppliers.length > 0 && (
          <Link href={panel === "add" ? "/app/parts/suppliers" : "/app/parts/suppliers?panel=add"} className={btn}>
            {panel === "add" ? "Close" : "Add a supplier"}
          </Link>
        )}
      </div>

      {adding && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 font-semibold">Add a supplier</h2>
          <ActionForm action={createSupplier} className="space-y-4">
            <SupplierFields prefix="new" />
            <button className={btn}>Add supplier</button>
          </ActionForm>
        </section>
      )}

      <div className={`${card} divide-y divide-slate-100`}>
        {suppliers.map((s) => {
          const address = [s.address_line1, s.city, s.region, s.postal_code].filter(Boolean).join(", ");
          return (
            <div key={s.id} className={`p-5 ${s.is_active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-semibold">{s.name}</span>
                  {!s.is_active && <span className="ml-2 text-xs text-steel">inactive</span>}
                  <div className="text-xs text-steel">
                    {[s.account_no && `Acct ${s.account_no}`, s.phone, s.email].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-xs text-steel">
                  {s.parts} part{s.parts === "1" ? "" : "s"} · {s.open_pos} open order{s.open_pos === "1" ? "" : "s"}
                </div>
              </div>

              <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                {address && (<><dt className="text-xs text-steel">Address</dt><dd>{address}</dd></>)}
                {s.hours && (<><dt className="text-xs text-steel">Hours</dt><dd>{s.hours}</dd></>)}
                <dt className="text-xs text-steel">Delivery</dt>
                <dd>
                  <span className="font-medium">{s.lead_time_days}-day lead time</span>
                  {s.delivery_notes && <span className="text-steel"> · {s.delivery_notes}</span>}
                </dd>
              </dl>

              {canEdit && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-steel hover:text-ink">Edit</summary>
                  <ActionForm action={updateSupplier} className="mt-3 space-y-4" keepAfterSuccess>
                    <input type="hidden" name="id" value={s.id} />
                    <SupplierFields s={s} prefix={`s-${s.id}`} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="is_active" defaultChecked={s.is_active} /> Active
                    </label>
                    <button className={btn}>Save</button>
                  </ActionForm>
                </details>
              )}
            </div>
          );
        })}
        {suppliers.length === 0 && (
          <p className="p-8 text-center text-sm text-steel">No suppliers yet. Add your first above.</p>
        )}
      </div>
    </div>
  );
}
