import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getShortcut, searchParts } from "@/lib/queries";
import { MODE_LABELS, hours, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ServiceNav } from "@/components/ServiceNav";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import {
  addShortcutLabour, addShortcutPart, deleteShortcut, removeShortcutLabour,
  removeShortcutPart, updateShortcut,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function ShortcutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ partq?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.role, "shortcuts.manage")) redirect("/app?denied=shortcuts");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { partq = "" } = await searchParams;

  const data = await getShortcut(session, id);
  if (!data) notFound();
  const { shortcut, labour, parts } = data;
  const hits = partq.trim() ? await searchParts(session, partq.trim()) : [];

  return (
    <div className="space-y-5">
      <ServiceNav role={session.role} active="shortcuts" />
      <div>
        <Link href="/app/shortcuts" className="text-sm text-steel hover:text-ink">← Shortcuts</Link>
        <h1 className="mt-1 text-2xl font-bold">
          <span className="font-mono">{shortcut.code}</span> · {shortcut.name}
        </h1>
      </div>

      <section className={`${card} p-5`}>
        <ActionForm action={updateShortcut} className="flex flex-wrap items-end gap-3" keepAfterSuccess>
          <input type="hidden" name="id" value={shortcut.id} />
          <div>
            <label className={label} htmlFor="u-code">Code</label>
            <input id="u-code" name="code" defaultValue={shortcut.code} required maxLength={12}
              className={`${input} w-32 font-mono uppercase`} />
          </div>
          <div className="min-w-64 flex-1">
            <label className={label} htmlFor="u-name">Service</label>
            <input id="u-name" name="name" defaultValue={shortcut.name} required maxLength={120}
              className={`${input} w-full`} />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={shortcut.is_active} /> Active
          </label>
          <button className={btnGhost}>Save</button>
        </ActionForm>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Labour -------------------------------------------------------- */}
        <section className={`${card} overflow-hidden`}>
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold">Labour</h2>
            <p className="text-xs text-steel">
              Leave rate and billing blank to use the shop rate and the order&apos;s billing mode.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Work</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {labour.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{l.description}</div>
                    <div className="text-xs text-steel">
                      {l.billing_mode ? MODE_LABELS[l.billing_mode] : "Order's billing mode"}
                      {!l.is_taxable && " · not taxable"}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{hours(l.hours)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-steel">{l.rate ? money(l.rate) : "shop rate"}</td>
                  <td className="px-5 py-3 text-right">
                    <ActionForm action={removeShortcutLabour} className="inline-block">
                      <input type="hidden" name="shortcut_id" value={shortcut.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <button className={btnDanger}>Delete</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
              {labour.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-steel">No labour. Parts-only shortcuts are fine.</td></tr>
              )}
            </tbody>
          </table>
          <ActionForm action={addShortcutLabour} className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:grid-cols-12">
            <input type="hidden" name="shortcut_id" value={shortcut.id} />
            <div className="sm:col-span-12">
              <label className={label} htmlFor="sl-desc">Add labour</label>
              <input id="sl-desc" name="description" required placeholder="e.g. Drain oil, replace filter, refill" className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-3">
              <label className={label} htmlFor="sl-hours">Hours</label>
              <input id="sl-hours" name="hours" required inputMode="decimal" className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-3">
              <label className={label} htmlFor="sl-rate">Rate</label>
              <input id="sl-rate" name="rate" inputMode="decimal" placeholder="shop rate" className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-6">
              <label className={label} htmlFor="sl-mode">Billing</label>
              <select id="sl-mode" name="mode" defaultValue="" className={`${input} w-full`}>
                <option value="">Use the order&apos;s mode</option>
                <option value="flat_rate">Flat rate</option>
                <option value="straight_time">Straight time</option>
              </select>
            </div>
            <div className="flex items-end gap-3 sm:col-span-12">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="taxable" defaultChecked /> Taxable
              </label>
              <button className={btn}>Add labour</button>
            </div>
          </ActionForm>
        </section>

        {/* Parts --------------------------------------------------------- */}
        <section className={`${card} overflow-hidden`}>
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold">Parts</h2>
            <p className="text-xs text-steel">Priced and reserved from live inventory when the shortcut is used.</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Part</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parts.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{p.description}</div>
                    <div className="font-mono text-xs text-steel">{p.sku}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{p.qty}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-steel">{money(p.unit_price)}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${p.available >= p.qty ? "text-emerald-700" : "text-red-700"}`}>
                    {p.available}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <ActionForm action={removeShortcutPart} className="inline-block">
                      <input type="hidden" name="shortcut_id" value={shortcut.id} />
                      <input type="hidden" name="line_id" value={p.id} />
                      <button className={btnDanger}>Delete</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
              {parts.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-steel">No parts. Labour-only shortcuts are fine.</td></tr>
              )}
            </tbody>
          </table>
          <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
            <form className="flex gap-2">
              <input name="partq" defaultValue={partq} aria-label="Search parts"
                placeholder="Find a part by SKU or description…" className={`${input} flex-1`} />
              <button className={btn}>Find</button>
            </form>
            {partq.trim() && hits.length === 0 && (
              <p className="text-sm text-steel">No parts match &ldquo;{partq}&rdquo;.</p>
            )}
            {hits.length > 0 && (
              <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {hits.map((h) => (
                  <ActionForm key={h.id} action={addShortcutPart} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="hidden" name="shortcut_id" value={shortcut.id} />
                    <input type="hidden" name="part_id" value={h.id} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{h.description}</div>
                      <div className="text-xs text-steel">
                        <span className="font-mono">{h.sku}</span> · {money(h.unit_price)}
                      </div>
                    </div>
                    <input name="qty" defaultValue={1} inputMode="numeric" aria-label="Quantity" className={`${input} w-16`} />
                    <button className={btn}>Add</button>
                  </ActionForm>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section>
        <ActionForm action={deleteShortcut}>
          <input type="hidden" name="id" value={shortcut.id} />
          <button className={btnDanger}>Delete this shortcut</button>
        </ActionForm>
        <p className="mt-1 text-xs text-steel">Work orders that already used it are not changed.</p>
      </section>
    </div>
  );
}
