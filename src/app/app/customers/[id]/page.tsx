import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCustomer, listTaxRates } from "@/lib/queries";
import { EXEMPT_REASON_LABELS, date, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { StatusBadge } from "@/components/StatusBadge";
import { btn, btnGhost, card, input, label } from "@/components/ui";
import { addVehicle, updateCustomer } from "../actions";
import { VehicleFields } from "@/components/VehicleFields";
import { CustomerFields } from "../CustomerFields";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vehicle?: string; panel?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "customers.view")) redirect("/app?denied=customers");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { vehicle: openVehicle, panel } = await searchParams;

  const [data, taxRates] = await Promise.all([
    getCustomer(session, id, openVehicle),
    listTaxRates(session),
  ]);
  if (!data) notFound();

  const { customer, vehicles } = data;
  const canEdit = can(session.role, "customers.edit");
  const canCreate = can(session.role, "workorders.create");

  // Keep whichever vehicle is open while a panel is toggled, and vice versa.
  const href = (next: { vehicle?: string | null; panel?: string | null }) => {
    const p = new URLSearchParams();
    const v = next.vehicle === undefined ? openVehicle : next.vehicle;
    const pa = next.panel === undefined ? panel : next.panel;
    if (v) p.set("vehicle", v);
    if (pa) p.set("panel", pa);
    const qs = p.toString();
    return `/app/customers/${customer.id}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header ------------------------------------------------------------------- */}
      <div>
        <Link href="/app/customers" className="text-sm text-steel hover:text-ink">← Customers</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{customer.display_name}</h1>
            <p className="text-sm text-steel">
              {[customer.phone, customer.email,
                [customer.address_line1, customer.city, customer.region, customer.postal_code]
                  .filter(Boolean).join(", ") || null,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>

          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Link href={href({ panel: panel === "edit" ? null : "edit" })} className={btnGhost}>
                {panel === "edit" ? "Close" : "Edit customer info"}
              </Link>
              <Link href={href({ panel: panel === "vehicle" ? null : "vehicle" })} className={btn}>
                {panel === "vehicle" ? "Close" : "Add a vehicle"}
              </Link>
            </div>
          )}
        </div>

        {customer.exempt_reason && (
          <p className={`mt-2 inline-block rounded-md px-2.5 py-1 text-xs ${
            customer.exemption_live ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}>
            <strong>
              {customer.exemption_live ? "HST exempt" : "HST exemption lapsed"}
            </strong>
            {" · "}{EXEMPT_REASON_LABELS[customer.exempt_reason] ?? customer.exempt_reason}
            {customer.exempt_reference && ` · ${customer.exempt_reference}`}
            {customer.exempt_expires_on && (
              customer.exemption_live
                ? ` · expires ${customer.exempt_expires_on}`
                : ` · expired ${customer.exempt_expires_on}; new work is being taxed`
            )}
          </p>
        )}
      </div>

      {/* Edit customer ------------------------------------------------------------- */}
      {canEdit && panel === "edit" && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 font-semibold">Edit customer info</h2>
          <ActionForm action={updateCustomer} className="space-y-4" keepAfterSuccess>
            <input type="hidden" name="id" value={customer.id} />
            <CustomerFields defaults={customer} taxRates={taxRates} />
            <button className={btn}>Save changes</button>
          </ActionForm>
        </section>
      )}

      {/* Add a vehicle ------------------------------------------------------------- */}
      {canEdit && panel === "vehicle" && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 font-semibold">Add a vehicle</h2>
          <ActionForm action={addVehicle} className="grid gap-3 sm:grid-cols-6">
            <input type="hidden" name="customer_id" value={customer.id} />
            <VehicleFields idPrefix="av" />
            <div className="sm:col-span-6"><button className={btn}>Add vehicle</button></div>
          </ActionForm>
        </section>
      )}

      {/* Vehicles ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Vehicles {vehicles.length > 0 && <span className="text-sm font-normal text-steel">({vehicles.length})</span>}
        </h2>

        {vehicles.length === 0 && (
          <p className="text-sm text-steel">No vehicles on file yet.</p>
        )}

        {/* One line each, folded shut. Opening one shows only its own history, so a
            fleet customer is a short list rather than a page of someone else's work. */}
        <div className={`${card} divide-y divide-slate-100`}>
          {vehicles.map((v) => {
            const title = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
            const isOpen = v.id === openVehicle;
            return (
              <div key={v.id}>
                <div className={`flex flex-wrap items-center gap-3 px-5 py-3 ${isOpen ? "bg-slate-50" : ""}`}>
                  <Link
                    href={href({ vehicle: isOpen ? null : v.id })}
                    className="group flex min-w-0 flex-1 items-center gap-3"
                    aria-expanded={isOpen}
                  >
                    <span className={`text-steel transition ${isOpen ? "rotate-90" : ""}`} aria-hidden>▸</span>
                    <span className="min-w-0">
                      <span className="font-semibold group-hover:underline">{title}</span>
                      <span className="block text-xs text-steel">
                        {[v.plate && `Plate ${v.plate}`, v.vin && `VIN ${v.vin}`,
                          v.current_mileage != null && `${v.current_mileage.toLocaleString()} km`]
                          .filter(Boolean).join(" · ") || "No plate or VIN on file"}
                      </span>
                    </span>
                  </Link>

                  <div className="flex items-center gap-3 text-xs text-steel">
                    <span>
                      {v.visits === 0 ? "No visits" : `${v.visits} visit${v.visits === 1 ? "" : "s"}`}
                      {v.last_visit && ` · last ${date(v.last_visit)}`}
                    </span>
                    {v.open_orders > 0 && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
                        {v.open_orders} open
                      </span>
                    )}
                    {canCreate && (
                      <Link
                        href={`/app/orders/new?customer=${customer.id}&vehicle=${v.id}`}
                        className={btnGhost}
                      >
                        New quote
                      </Link>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                    {v.history.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase tracking-wide text-steel">
                          <tr>
                            <th className="py-1.5">Order</th>
                            <th className="py-1.5">Date</th>
                            <th className="py-1.5">Mileage in</th>
                            <th className="py-1.5">Concern</th>
                            <th className="py-1.5">Status</th>
                            <th className="py-1.5 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {v.history.map((h) => (
                            <tr key={h.id}>
                              <td className="py-2">
                                <Link href={`/app/orders/${h.id}`} className="font-medium hover:underline">#{h.number}</Link>
                              </td>
                              <td className="py-2 text-steel">{date(h.created_at)}</td>
                              <td className="py-2 tabular-nums text-steel">
                                {h.mileage_in != null ? h.mileage_in.toLocaleString() : "—"}
                              </td>
                              <td className="max-w-xs truncate py-2 text-steel">{h.concern}</td>
                              <td className="py-2"><StatusBadge status={h.status} /></td>
                              <td className="py-2 text-right tabular-nums">{money(h.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-steel">No service history for this vehicle yet.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
