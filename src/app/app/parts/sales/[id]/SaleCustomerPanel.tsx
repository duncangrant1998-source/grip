import Link from "next/link";
import { inShop } from "@/lib/auth";
import type { Session } from "@/lib/session";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnGhost, card, input, label } from "@/components/ui";
import { NewCustomerInline } from "../../../customers/NewCustomerInline";
import { changeSaleCustomer } from "../actions";

/**
 * Who a counter sale is for, changeable while it is still open: a customer on
 * file (whose tax arrangement the sale then takes on), a named walk-in, or
 * someone brand new added on the spot.
 */
export async function SaleCustomerPanel({
  session, saleId, currentName, search,
}: {
  session: Session;
  saleId: string;
  currentName: string | null;
  search: string;
}) {
  const q = search.trim();
  const like = `%${q}%`;

  const results = q
    ? await inShop(session, (tx) => tx<{ id: string; display_name: string; phone: string | null; email: string | null }[]>`
        SELECT id, display_name, phone, email FROM grip.customers
        WHERE display_name ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like}
        ORDER BY display_name LIMIT 10`)
    : [];

  const here = `/app/parts/sales/${saleId}`;

  return (
    <section className={`${card} space-y-6 p-5`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Who is this sale for?</h2>
        <Link href={here} className={btnGhost}>Close</Link>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">A customer on file</div>
        <form className="flex gap-2">
          <input type="hidden" name="panel" value="customer" />
          <input
            name="cq" defaultValue={q} aria-label="Search customers" autoFocus
            placeholder="Name, phone or email…" className={`${input} max-w-md flex-1`}
          />
          <button className={btn}>Search</button>
        </form>

        {q && results.length === 0 && (
          <p className="mt-3 text-sm text-steel">No customers match &ldquo;{q}&rdquo;.</p>
        )}
        {results.length > 0 && (
          <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {results.map((c) => (
              <ActionForm key={c.id} action={changeSaleCustomer} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <input type="hidden" name="sale_id" value={saleId} />
                <input type="hidden" name="customer_id" value={c.id} />
                <div className="text-sm">
                  <span className="font-medium">{c.display_name}</span>
                  <span className="ml-2 text-steel">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                </div>
                <button className={btnGhost}>Use this customer</button>
              </ActionForm>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">Or just a name</div>
        <ActionForm action={changeSaleCustomer} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="sale_id" value={saleId} />
          <div>
            <label className={label} htmlFor="sale-walkin">Walk-in name</label>
            <input
              id="sale-walkin" name="customer_name" maxLength={120} className={`${input} w-72`}
              defaultValue={currentName && currentName !== "Walk-in" ? currentName : ""} placeholder="Walk-in"
            />
          </div>
          <button className={btnGhost}>Use this name</button>
          <span className="pb-2 text-xs text-steel">Not tied to a customer record; the shop&apos;s normal tax applies.</span>
        </ActionForm>
      </div>

      <div className="rounded-md border border-dashed border-slate-300 p-4">
        <NewCustomerInline
          then={`sale:${saleId}`}
          title="Not on file? Add a new customer and put this sale under them"
          submitLabel="Add customer and use them"
          vehicleRequired={false}
        />
      </div>
    </section>
  );
}
