import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, inShop } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listCustomers } from "@/lib/queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input } from "@/components/ui";
import { AddVehicleInline } from "../../customers/AddVehicleInline";
import { NewCustomerInline } from "../../customers/NewCustomerInline";
import { createOrder } from "../actions";

export const dynamic = "force-dynamic";

/**
 * A quote starts the moment a vehicle is chosen: there is no confirmation step
 * to click through. Customer, then vehicle, then you are on the work order —
 * where the concern, mileage, labour and parts are all edited in place.
 *
 * Someone who isn't on file yet, or a vehicle that isn't, is added right here
 * rather than somewhere else and then found again.
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; q?: string; panel?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "workorders.create")) redirect("/app?denied=quotes");

  const sp = await searchParams;
  const canAdd = can(session.role, "customers.edit");
  const customerId = /^[0-9a-f-]{36}$/i.test(sp.customer ?? "") ? sp.customer! : null;

  // Step 2: a customer is chosen. Pick one of their vehicles — or add one.
  if (customerId) {
    const data = await inShop(session, async (tx) => {
      const [customer] = await tx<{ id: string; display_name: string; phone: string | null }[]>`
        SELECT id, display_name, phone FROM grip.customers WHERE id = ${customerId}`;
      if (!customer) return null;
      const vehicles = await tx<
        { id: string; year: number | null; make: string | null; model: string | null; trim: string | null;
          plate: string | null; current_mileage: number | null }[]
      >`SELECT id, year, make, model, trim, plate, current_mileage
        FROM grip.vehicles WHERE customer_id = ${customerId} ORDER BY created_at`;
      return { customer, vehicles };
    });
    if (!data) redirect("/app/orders/new");

    const { customer, vehicles } = data;
    const addingVehicle = sp.panel === "vehicle" || vehicles.length === 0;
    const here = `/app/orders/new?customer=${customer.id}`;

    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Link href="/app/orders/new" className="text-sm text-steel hover:text-ink">← Choose a different customer</Link>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">New quote</h1>
              <p className="text-steel">
                for <span className="font-medium text-ink">{customer.display_name}</span>
                {customer.phone && ` · ${customer.phone}`}
              </p>
            </div>
            {canAdd && vehicles.length > 0 && (
              <Link href={addingVehicle ? here : `${here}&panel=vehicle`} className={btnGhost}>
                {addingVehicle ? "Close" : "Add a vehicle"}
              </Link>
            )}
          </div>
        </div>

        {vehicles.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-steel">Which vehicle?</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {vehicles.map((v) => (
                <ActionForm key={v.id} action={createOrder}>
                  <input type="hidden" name="customer_id" value={customer.id} />
                  <input type="hidden" name="vehicle_id" value={v.id} />
                  <button className={`${card} w-full p-4 text-left transition hover:border-shop hover:bg-orange-50`}>
                    <span className="block font-semibold">
                      {[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle"}
                    </span>
                    <span className="block text-xs text-steel">
                      {[v.plate, v.current_mileage != null && `${v.current_mileage.toLocaleString()} km`]
                        .filter(Boolean).join(" · ") || "No plate on file"}
                    </span>
                    <span className="mt-2 block text-xs font-medium text-shop">Start quote →</span>
                  </button>
                </ActionForm>
              ))}
            </div>
          </section>
        )}

        {canAdd && addingVehicle && (
          <section className={`${card} p-5`}>
            <AddVehicleInline
              customerId={customer.id}
              customerName={customer.display_name}
              then="quote"
              submitLabel="Add vehicle and start quote"
            />
          </section>
        )}

        {!canAdd && vehicles.length === 0 && (
          <p className={`${card} p-5 text-sm text-steel`}>
            This customer has no vehicles on file, and your login can&apos;t add one. Ask the service desk.
          </p>
        )}
      </div>
    );
  }

  // Step 1: choose a customer, or add one.
  const q = (sp.q ?? "").trim();
  const customers = await listCustomers(session, q);
  const addingCustomer = sp.panel === "customer";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/app/orders" className="text-sm text-steel hover:text-ink">← Quotes and work orders</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">New quote</h1>
            <p className="text-steel">Who is it for?</p>
          </div>
          {canAdd && (
            <Link
              href={addingCustomer ? `/app/orders/new${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/app/orders/new?panel=customer${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={btn}
            >
              {addingCustomer ? "Close" : "New customer"}
            </Link>
          )}
        </div>
      </div>

      {canAdd && addingCustomer && (
        <section className={`${card} p-5`}>
          <NewCustomerInline
            then="quote"
            title="New customer and their vehicle"
            submitLabel="Add customer and start quote"
          />
        </section>
      )}

      <form className="flex gap-2">
        <input name="q" defaultValue={q} autoFocus={!addingCustomer} aria-label="Search customers"
          placeholder="Name, email, phone, address, VIN, plate…" className={`${input} flex-1`} />
        <button className={btn}>Search</button>
      </form>

      <div className={`${card} divide-y divide-slate-100`}>
        {customers.slice(0, 15).map((c) => (
          <Link key={c.id} href={`/app/orders/new?customer=${c.id}`}
            className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-slate-50">
            <span className="font-medium">{c.display_name}</span>
            <span className="truncate text-steel">
              {[c.phone, c.address].filter(Boolean).join(" · ")}
              {" · "}{c.vehicles} vehicle{c.vehicles === "1" ? "" : "s"}
            </span>
          </Link>
        ))}
        {customers.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-steel">
            No customers match{canAdd ? " — use New customer above to add them." : "."}
          </p>
        )}
      </div>
    </div>
  );
}
