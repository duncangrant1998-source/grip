import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, inShop } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listCustomers, listTechnicians } from "@/lib/queries";
import { getScheduleContext, listBays } from "@/lib/schedule-queries";
import { isDateString } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input } from "@/components/ui";
import { AddVehicleInline } from "../../customers/AddVehicleInline";
import { NewCustomerInline } from "../../customers/NewCustomerInline";
import { createAppointment } from "../actions";
import { AppointmentFields } from "../AppointmentFields";

export const dynamic = "force-dynamic";

/**
 * Pick the customer (or add them), pick the vehicle (or add one), choose the
 * slot. Booking then opens the work order, which it has started: the concern,
 * the quote and the parts desk's view of what is coming all begin there.
 * The date, time and bay chosen by clicking the calendar ride through every step.
 */
export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    customer?: string; vehicle?: string; date?: string; time?: string; bay?: string;
    tech?: string; minutes?: string; concern?: string; q?: string; panel?: string;
  }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "appointments.edit", session.extraRoles)) redirect("/app?denied=booking appointments");

  const sp = await searchParams;
  const ctx = await getScheduleContext(session);
  const date = isDateString(sp.date) ? sp.date : ctx.today;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(sp.time ?? "") ? sp.time! : "09:00";
  const bay = /^[0-9a-f-]{36}$/i.test(sp.bay ?? "") ? sp.bay! : "";
  const canAdd = can(session.role, "customers.edit", session.extraRoles);

  const carryParams = new URLSearchParams({ date, time });
  if (bay) carryParams.set("bay", bay);
  const carry = carryParams.toString();

  const customerId = /^[0-9a-f-]{36}$/i.test(sp.customer ?? "") ? sp.customer! : null;

  if (customerId) {
    const [data, bays, techs] = await Promise.all([
      inShop(session, async (tx) => {
        const [customer] = await tx<{ id: string; display_name: string; phone: string | null }[]>`
          SELECT id, display_name, phone FROM grip.customers WHERE id = ${customerId}`;
        if (!customer) return null;
        const vehicles = await tx<
          { id: string; year: number | null; make: string | null; model: string | null; trim: string | null; plate: string | null }[]
        >`SELECT id, year, make, model, trim, plate FROM grip.vehicles WHERE customer_id = ${customerId} ORDER BY created_at`;
        return { customer, vehicles };
      }),
      listBays(session),
      listTechnicians(session),
    ]);
    if (!data) redirect(`/app/schedule/new?${carry}`);
    const { customer, vehicles } = data;
    const preselect = sp.vehicle ?? (vehicles.length === 1 ? vehicles[0].id : "");
    const addingVehicle = sp.panel === "vehicle" || vehicles.length === 0;
    const here = `/app/schedule/new?customer=${customer.id}&${carry}`;

    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Link href={`/app/schedule/new?${carry}`} className="text-sm text-steel hover:text-ink">← Choose a different customer</Link>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Book an appointment</h1>
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

        {canAdd && addingVehicle && (
          <section className={`${card} p-5`}>
            <AddVehicleInline
              customerId={customer.id}
              customerName={customer.display_name}
              then={`appointment:${carry}`}
              submitLabel="Add vehicle and continue"
            />
          </section>
        )}

        {vehicles.length > 0 && (
          <ActionForm action={createAppointment} className={`${card} space-y-5 p-5`} keepAfterSuccess>
            <input type="hidden" name="customer_id" value={customer.id} />
            <fieldset>
              <legend className="mb-1 block text-xs font-medium text-steel">Vehicle</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {vehicles.map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2.5 text-sm has-[:checked]:border-shop has-[:checked]:bg-orange-50">
                    <input type="radio" name="vehicle_id" value={v.id} required defaultChecked={v.id === preselect} />
                    <span className="font-medium">{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle"}</span>
                    {v.plate && <span className="text-steel">{v.plate}</span>}
                  </label>
                ))}
              </div>
            </fieldset>

            <AppointmentFields
              defaults={{
                date, time, bay_id: bay, tech_id: sp.tech, concern: sp.concern,
                minutes: Number(sp.minutes) || undefined,
              }}
              bays={bays}
              techs={techs}
            />
            <div className="flex items-center gap-3">
              <button className={btn}>Book appointment</button>
              <span className="text-xs text-steel">You&apos;ll land on the work order, ready for the quote.</span>
            </div>
          </ActionForm>
        )}
      </div>
    );
  }

  // Step 1: choose a customer, or add one.
  const q = (sp.q ?? "").trim();
  const customers = await listCustomers(session, q);
  const addingCustomer = sp.panel === "customer";
  const toggle = addingCustomer
    ? `/app/schedule/new?${carry}${q ? `&q=${encodeURIComponent(q)}` : ""}`
    : `/app/schedule/new?${carry}&panel=customer${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/app/schedule?date=${date}`} className="text-sm text-steel hover:text-ink">← Schedule</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Book an appointment</h1>
            <p className="text-steel">Who is it for?</p>
          </div>
          {canAdd && <Link href={toggle} className={btn}>{addingCustomer ? "Close" : "New customer"}</Link>}
        </div>
      </div>

      {canAdd && addingCustomer && (
        <section className={`${card} p-5`}>
          <NewCustomerInline
            then={`appointment:${carry}`}
            title="New customer and their vehicle"
            submitLabel="Add customer and continue"
            vehicleRequired={false}
          />
        </section>
      )}

      <form className="flex gap-2">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="time" value={time} />
        {bay && <input type="hidden" name="bay" value={bay} />}
        <input name="q" defaultValue={q} autoFocus={!addingCustomer} aria-label="Search customers"
          placeholder="Name, email, phone, address, VIN, plate…" className={`${input} flex-1`} />
        <button className={btn}>Search</button>
      </form>

      <div className={`${card} divide-y divide-slate-100`}>
        {customers.slice(0, 15).map((c) => (
          <Link key={c.id} href={`/app/schedule/new?customer=${c.id}&${carry}`}
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
