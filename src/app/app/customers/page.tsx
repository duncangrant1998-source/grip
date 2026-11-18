import Link from "next/link";
import { ClickRow } from "@/components/ClickRow";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listCustomers, listTaxRates } from "@/lib/queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input } from "@/components/ui";
import { createCustomer } from "./actions";
import { CustomerFields } from "./CustomerFields";
import { VehicleFields } from "@/components/VehicleFields";
import { ImportCustomers } from "./ImportCustomers";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; next?: string; panel?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "customers.view", session.extraRoles)) redirect("/app?denied=customers");

  const { q = "", next, panel: panelParam } = await searchParams;
  // Arriving from "new work order" with a walk-in: after saving, go back to it,
  // and have the add form already open.
  const returnToOrder = next === "order";
  const panel = panelParam ?? (returnToOrder ? "add" : undefined);
  const [customers, taxRates] = await Promise.all([
    listCustomers(session, q.trim()),
    listTaxRates(session),
  ]);
  const canEdit = can(session.role, "customers.edit", session.extraRoles);

  // Toggle a panel from its own button, keeping the search and the walk-in
  // return-to-order flag.
  const href = (target: "add" | "import") => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (returnToOrder) p.set("next", "order");
    if (panel !== target) p.set("panel", target);
    else if (returnToOrder && target === "add") p.set("panel", "closed");
    const qs = p.toString();
    return `/app/customers${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Customers</h1>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <form className="flex w-full gap-2 sm:w-auto">
            <input
              name="q" defaultValue={q} placeholder="Name, email, phone, address, VIN, plate…"
              className={`${input} min-w-0 flex-1 sm:w-80 sm:flex-none`} aria-label="Search customers"
            />
            <button className={btn}>Search</button>
          </form>
          {canEdit && (
            <Link href={href("import")} className={btnGhost}>
              {panel === "import" ? "Close" : "Import CSV"}
            </Link>
          )}
          <a href="/app/customers/export" className={btnGhost} download>Export CSV</a>
          {canEdit && (
            <Link href={href("add")} className={btn}>
              {panel === "add" ? "Close" : "Add a customer"}
            </Link>
          )}
        </div>
      </div>

      {/* Panels open under the buttons, above the list ----------------------------- */}
      {canEdit && panel === "add" && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 font-semibold">Add a customer</h2>
          <ActionForm action={createCustomer} className="space-y-4" keepAfterSuccess>
            {returnToOrder && <input type="hidden" name="next" value="order" />}
            <CustomerFields taxRates={taxRates} />
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-1 font-semibold">Their vehicle</div>
              <p className="mb-3 text-xs text-steel">
                Add the car now, or leave this empty and add it later. Type a VIN and press
                &ldquo;Fill from VIN&rdquo; to get the year, make, model and trim.
              </p>
              <div className="grid gap-3 sm:grid-cols-6">
                <VehicleFields prefix="v_" mileageName="v_mileage" idPrefix="cv" />
              </div>
            </div>
            <button className={btn}>Save customer</button>
          </ActionForm>
        </section>
      )}

      {canEdit && panel === "import" && (
        <section className={`${card} p-5`}>
          <h2 className="mb-2 font-semibold">Import from a spreadsheet</h2>
          <div className="space-y-4">
            <p className="max-w-3xl text-xs text-steel">
              One row per vehicle, with the customer repeated for each of theirs; a customer with no
              vehicle gets a row of their own. The heading must include <code>name</code>, and may
              also use <code>email</code>, <code>phone</code>, <code>address</code>, <code>city</code>,{" "}
              <code>province</code>, <code>postal_code</code>, <code>notes</code>,{" "}
              <code>vehicle_year</code>, <code>vehicle_make</code>, <code>vehicle_model</code>, <code>vehicle_trim</code>,{" "}
              <code>vehicle_vin</code>, <code>vehicle_plate</code> and <code>vehicle_mileage</code>.
              Anything else is ignored. Customers already on file are matched by name and left
              exactly as they are — an import only ever adds.
            </p>
            <ImportCustomers />
          </div>
        </section>
      )}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Vehicles</th>
              <th className="px-4 py-3 text-right">Open orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map((c) => (
              <ClickRow key={c.id} href={`/app/customers/${c.id}`}>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/app/customers/${c.id}`} className="hover:underline">{c.display_name}</Link>
                </td>
                <td className="px-4 py-3 text-steel">{c.email ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-steel">{c.phone ?? "—"}</td>
                <td className="max-w-xs truncate px-4 py-3 text-steel">{c.address ?? "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.vehicles}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {Number(c.open_orders) > 0
                    ? <span className="font-medium">{c.open_orders}</span>
                    : <span className="text-steel">0</span>}
                </td>
              </ClickRow>
            ))}
            {customers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-steel">
                {q ? "No customers match that search." : "No customers yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
