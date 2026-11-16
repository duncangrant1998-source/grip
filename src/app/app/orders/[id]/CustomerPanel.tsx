import Link from "next/link";
import { inShop } from "@/lib/auth";
import type { Session } from "@/lib/session";
import { listTaxRates } from "@/lib/queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input, label } from "@/components/ui";
import { addVehicle, updateCustomer } from "../../customers/actions";
import { CustomerFields } from "../../customers/CustomerFields";
import { NewCustomerInline } from "../../customers/NewCustomerInline";
import { changeOrderCustomer } from "../actions";

type VehicleRow = {
  id: string; year: number | null; make: string | null; model: string | null; trim: string | null;
  plate: string | null; current_mileage: number | null;
};

const vehicleName = (v: VehicleRow) =>
  [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";

/**
 * Everything about who this order is for, in one place: pick another vehicle,
 * correct the customer's details, add a vehicle they've just bought, or move
 * the whole order to someone else.
 */
export async function CustomerPanel({
  session, orderId, customerId, vehicleId, search,
}: {
  session: Session;
  orderId: string;
  customerId: string;
  vehicleId: string;
  search: string;
}) {
  const q = search.trim();
  const like = `%${q}%`;

  const [taxRates, data] = await Promise.all([
    listTaxRates(session),
    inShop(session, async (tx) => {
      const [customer] = await tx<
        { id: string; display_name: string; phone: string | null; email: string | null;
          address_line1: string | null; city: string | null; region: string | null;
          postal_code: string | null; notes: string | null; tax_rate_id: string | null;
          exempt_reason: string | null; exempt_reference: string | null;
          exempt_expires_on: string | null }[]
      >`SELECT id, display_name, phone, email, address_line1, city, region, postal_code,
               notes, tax_rate_id, exempt_reason, exempt_reference,
               to_char(exempt_expires_on, 'YYYY-MM-DD') AS exempt_expires_on
        FROM grip.customers WHERE id = ${customerId}`;

      const vehicles = await tx<VehicleRow[]>`
        SELECT id, year, make, model, trim, plate, current_mileage
        FROM grip.vehicles WHERE customer_id = ${customerId} ORDER BY created_at`;

      // Other customers, only once someone has searched: a shop with thousands
      // of them should not render them all just because the panel is open.
      const others = q
        ? await tx<{ id: string; display_name: string; phone: string | null }[]>`
            SELECT c.id, c.display_name, c.phone FROM grip.customers c
            WHERE c.id <> ${customerId}
              AND (c.display_name ILIKE ${like} OR c.phone ILIKE ${like} OR c.email ILIKE ${like}
                   OR EXISTS (SELECT 1 FROM grip.vehicles v WHERE v.customer_id = c.id
                              AND (v.vin ILIKE ${like} OR v.plate ILIKE ${like})))
            ORDER BY c.display_name LIMIT 8`
        : [];
      const otherVehicles = others.length
        ? await tx<(VehicleRow & { customer_id: string })[]>`
            SELECT id, customer_id, year, make, model, trim, plate, current_mileage
            FROM grip.vehicles WHERE customer_id = ANY(${others.map((o) => o.id)}::uuid[])
            ORDER BY created_at`
        : [];
      return { customer, vehicles, others, otherVehicles };
    }),
  ]);
  if (!data.customer) return null;
  const { customer, vehicles, others, otherVehicles } = data;

  const here = `/app/orders/${orderId}`;

  return (
    <section className={`${card} space-y-6 p-5`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Customer and vehicle</h2>
        <Link href={here} className={btnGhost}>Close</Link>
      </div>

      {/* This customer's vehicles ------------------------------------------------ */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">
          {customer.display_name}&apos;s vehicles
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => (
            <ActionForm key={v.id} action={changeOrderCustomer}>
              <input type="hidden" name="work_order_id" value={orderId} />
              <input type="hidden" name="customer_id" value={customer.id} />
              <input type="hidden" name="vehicle_id" value={v.id} />
              <button
                disabled={v.id === vehicleId}
                className={`w-full rounded-md border px-3 py-2.5 text-left text-sm ${
                  v.id === vehicleId
                    ? "border-shop bg-orange-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="block font-medium">{vehicleName(v)}</span>
                <span className="block text-xs text-steel">
                  {[v.plate, v.current_mileage != null && `${v.current_mileage.toLocaleString()} km`]
                    .filter(Boolean).join(" · ") || "No plate on file"}
                  {v.id === vehicleId && " · on this order"}
                </span>
              </button>
            </ActionForm>
          ))}
        </div>

        <ActionForm action={addVehicle} className="mt-3 grid gap-3 rounded-md border border-dashed border-slate-300 p-3 sm:grid-cols-12">
          <input type="hidden" name="customer_id" value={customer.id} />
          <div className="text-xs font-medium text-steel sm:col-span-12">Add a vehicle to {customer.display_name}</div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="av-year">Year</label>
            <input id="av-year" name="year" inputMode="numeric" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="av-make">Make</label>
            <input id="av-make" name="make" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="av-model">Model</label>
            <input id="av-model" name="model" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-4">
            <label className={label} htmlFor="av-vin">VIN</label>
            <input id="av-vin" name="vin" maxLength={17} className={`${input} w-full font-mono uppercase`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="av-plate">Plate</label>
            <input id="av-plate" name="plate" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="av-km">Mileage (km)</label>
            <input id="av-km" name="current_mileage" inputMode="numeric" className={`${input} w-full`} />
          </div>
          <div className="flex items-end sm:col-span-3"><button className={btn}>Add vehicle</button></div>
        </ActionForm>
      </div>

      {/* Edit the customer ------------------------------------------------------ */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">
          Edit {customer.display_name}&apos;s details
        </div>
        <ActionForm action={updateCustomer} className="space-y-4" keepAfterSuccess>
          <input type="hidden" name="id" value={customer.id} />
          <CustomerFields defaults={customer} taxRates={taxRates} />
          <button className={btn}>Save customer details</button>
        </ActionForm>
      </div>

      {/* Someone else ---------------------------------------------------------- */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">
          Move this order to a different customer
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="panel" value="customer" />
          <input
            name="cq" defaultValue={q} aria-label="Search customers"
            placeholder="Name, phone, email, VIN or plate…" className={`${input} max-w-md flex-1`}
          />
          <button className={btn}>Search</button>
        </form>

        {q && others.length === 0 && (
          <p className="mt-3 text-sm text-steel">No other customers match &ldquo;{q}&rdquo;.</p>
        )}

        {others.length > 0 && (
          <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {others.map((o) => {
              const theirs = otherVehicles.filter((v) => v.customer_id === o.id);
              return (
                <div key={o.id} className="px-4 py-3">
                  <div className="text-sm font-medium">
                    {o.display_name} <span className="font-normal text-steel">{o.phone}</span>
                  </div>
                  {theirs.length === 0 ? (
                    <p className="text-xs text-steel">
                      No vehicles on file.{" "}
                      <Link href={`/app/customers/${o.id}?panel=vehicle`} className="underline">Add one first</Link>.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {theirs.map((v) => (
                        <ActionForm key={v.id} action={changeOrderCustomer}>
                          <input type="hidden" name="work_order_id" value={orderId} />
                          <input type="hidden" name="customer_id" value={o.id} />
                          <input type="hidden" name="vehicle_id" value={v.id} />
                          <button className={btnGhost}>
                            Use {vehicleName(v)}{v.plate ? ` · ${v.plate}` : ""}
                          </button>
                        </ActionForm>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* A customer who isn't on file yet ------------------------------------------ */}
      <div className="rounded-md border border-dashed border-slate-300 p-4">
        <NewCustomerInline
          then={`order:${orderId}`}
          title="Not on file? Add a new customer and move this order to them"
          submitLabel="Add customer and move the order"
        />
      </div>
    </section>
  );
}
