import Link from "next/link";
import { ClickRow } from "@/components/ClickRow";
import { requireDepartment } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  activeSuppliers, categoryCounts, inventorySummary, listParts, resolvePartSearch, type PartView,
} from "@/lib/parts-queries";
import { money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { LiveRefresh } from "@/components/LiveRefresh";
import { btn, btnGhost, card, input } from "@/components/ui";
import { createPart } from "./actions";
import { PartFields } from "./PartFields";

export const dynamic = "force-dynamic";

const VIEWS: { key: PartView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
  { key: "ordered", label: "On order" },
];

const NONE = "__none__";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; cat?: string; sub?: string; panel?: string }>;
}) {
  const session = await requireDepartment("parts");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "all") as PartView;
  const cat = sp.cat ?? "";
  const sub = cat ? (sp.sub ?? "") : "";

  const canEdit = can(session.role, "inventory.edit");
  const showCost = can(session.role, "parts.viewCost");

  // A VIN in the search box becomes "parts for that vehicle".
  const { vehicle, vinError } = await resolvePartSearch(q);

  const [summary, parts, suppliers, cats] = await Promise.all([
    inventorySummary(session),
    listParts(session, { q, view, vehicle, category: cat || undefined, subcategory: sub || undefined }),
    canEdit ? activeSuppliers(session) : Promise.resolve([]),
    categoryCounts(session),
  ]);

  // The category bar: one chip per category, with the sub-categories of the chosen one beneath.
  const byCategory = new Map<string, { n: number; subs: Map<string, number> }>();
  for (const c of cats) {
    const key = c.category ?? NONE;
    const entry = byCategory.get(key) ?? { n: 0, subs: new Map() };
    entry.n += c.n;
    entry.subs.set(c.subcategory ?? NONE, (entry.subs.get(c.subcategory ?? NONE) ?? 0) + c.n);
    byCategory.set(key, entry);
  }
  const total = cats.reduce((n, c) => n + c.n, 0);
  const categoryNames = [...byCategory.keys()].filter((k) => k !== NONE);
  const subcategoryNames = [...new Set(cats.map((c) => c.subcategory).filter((s): s is string => !!s))];

  const href = (next: { view?: string; cat?: string; sub?: string; panel?: string | null }) => {
    const p = new URLSearchParams();
    const v = next.view ?? view;
    const c = next.cat === undefined ? cat : next.cat;
    const s = next.sub === undefined ? sub : next.sub;
    const pa = next.panel === undefined ? sp.panel : next.panel;
    if (v !== "all") p.set("view", v);
    if (c) p.set("cat", c);
    if (s) p.set("sub", s);
    if (q) p.set("q", q);
    if (pa) p.set("panel", pa);
    const qs = p.toString();
    return `/app/parts${qs ? `?${qs}` : ""}`;
  };

  const tiles = [
    { label: "Active SKUs", value: String(summary.skus), href: "/app/parts" },
    { label: "At or below reorder point", value: String(summary.low), href: "/app/parts?view=low", warn: summary.low > 0 },
    { label: "Out of stock", value: String(summary.out), href: "/app/parts?view=out", warn: summary.out > 0 },
    ...(showCost ? [{ label: "Inventory value (at cost)", value: money(summary.value), href: "/app/parts" }] : []),
    { label: "Open purchase orders", value: String(summary.openPos), href: "/app/parts/orders" },
  ];

  const colSpan = showCost ? 9 : 8;
  let lastGroup: string | null = null;

  return (
    <div className="space-y-6">
      <LiveRefresh everyMs={10000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Inventory</h1>
        {canEdit && (
          <Link href={href({ panel: sp.panel === "add" ? null : "add" })} className={btn}>
            {sp.panel === "add" ? "Close" : "Add a part"}
          </Link>
        )}
      </div>

      {canEdit && sp.panel === "add" && (
        <section className={`${card} p-5`}>
          <h2 className="mb-4 font-semibold">Add a part</h2>
          <ActionForm action={createPart} className="space-y-4" keepAfterSuccess>
            <PartFields
              suppliers={suppliers} withOpeningQty
              categories={categoryNames} subcategories={subcategoryNames}
              defaults={{ category: cat && cat !== NONE ? cat : undefined, subcategory: sub && sub !== NONE ? sub : undefined }}
            />
            <button className={btn}>Add part</button>
          </ActionForm>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`${card} p-4 transition hover:border-slate-300`}>
            <div className={`text-2xl font-bold tabular-nums ${t.warn ? "text-amber-700" : ""}`}>{t.value}</div>
            <div className="mt-0.5 text-xs text-steel">{t.label}</div>
          </Link>
        ))}
      </div>

      {/* Browse by category and sub-category ----------------------------------------- */}
      {byCategory.size > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 text-sm">
            <Link
              href={href({ cat: "", sub: "" })}
              className={`rounded-full border px-3 py-1 font-medium ${
                !cat ? "border-shop bg-orange-50" : "border-slate-200 bg-white text-steel hover:text-ink"
              }`}
            >
              All categories <span className="text-xs text-steel">{total}</span>
            </Link>
            {[...byCategory.entries()].map(([name, c]) => (
              <Link
                key={name}
                href={href({ cat: name, sub: "" })}
                className={`rounded-full border px-3 py-1 font-medium ${
                  cat === name ? "border-shop bg-orange-50" : "border-slate-200 bg-white text-steel hover:text-ink"
                }`}
              >
                {name === NONE ? "Uncategorised" : name} <span className="text-xs text-steel">{c.n}</span>
              </Link>
            ))}
          </div>
          {cat && byCategory.get(cat) && byCategory.get(cat)!.subs.size > 1 && (
            <div className="flex flex-wrap gap-1.5 border-l-2 border-slate-200 pl-3 text-xs">
              <Link
                href={href({ sub: "" })}
                className={`rounded-full border px-2.5 py-0.5 font-medium ${
                  !sub ? "border-shop bg-orange-50" : "border-slate-200 bg-white text-steel hover:text-ink"
                }`}
              >
                All {cat === NONE ? "uncategorised" : cat}
              </Link>
              {[...byCategory.get(cat)!.subs.entries()].map(([name, n]) => (
                <Link
                  key={name}
                  href={href({ sub: name })}
                  className={`rounded-full border px-2.5 py-0.5 font-medium ${
                    sub === name ? "border-shop bg-orange-50" : "border-slate-200 bg-white text-steel hover:text-ink"
                  }`}
                >
                  {name === NONE ? "No sub-category" : name} <span className="text-steel">{n}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key })}
              className={`rounded-md px-3 py-1.5 font-medium ${
                view === v.key ? "bg-white shadow-sm" : "text-steel hover:text-ink"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <form className="flex w-full gap-2 sm:w-auto">
          <input type="hidden" name="view" value={view} />
          {cat && <input type="hidden" name="cat" value={cat} />}
          {sub && <input type="hidden" name="sub" value={sub} />}
          <input name="q" defaultValue={q} aria-label="Search parts"
            placeholder="SKU, description, category, bin, or a VIN…"
            className={`${input} min-w-0 flex-1 sm:w-72 sm:flex-none`} />
          <button className={btn}>Search</button>
          {(q || cat) && <Link href="/app/parts" className={btnGhost}>Clear</Link>}
        </form>
      </div>

      {vehicle && (
        <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Parts for <strong>{vehicle.label}</strong> (from the VIN). Showing parts whose &ldquo;Fits&rdquo; list or
          description mentions {vehicle.model ?? vehicle.make}. Add the vehicles a part fits to its &ldquo;Fits&rdquo; field to
          make it show up here.
        </p>
      )}
      {vinError && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{vinError}</p>}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Bin</th>
              <th className="px-3 py-3 text-right">On hand</th>
              <th className="px-3 py-3 text-right">Reserved</th>
              <th className="px-3 py-3 text-right">Available</th>
              <th className="px-3 py-3 text-right">On order</th>
              {showCost && <th className="px-3 py-3 text-right">Cost</th>}
              <th className="px-3 py-3 text-right">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {parts.map((p) => {
              const low = p.reorder_point > 0 && p.available <= p.reorder_point;
              const group = [p.category ?? "Uncategorised", p.subcategory].filter(Boolean).join(" › ");
              const header = group !== lastGroup;
              lastGroup = group;
              return [
                header && (
                  <tr key={`g-${group}`} className="bg-slate-50/70">
                    <td colSpan={colSpan} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-steel">
                      {group}
                    </td>
                  </tr>
                ),
                <ClickRow key={p.id} href={`/app/parts/${p.id}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <Link href={`/app/parts/${p.id}`} className="font-semibold hover:underline">{p.sku}</Link>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.description}
                    {p.supplier_name && <div className="text-xs text-steel">{p.supplier_name}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-steel">{p.bin_location}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.on_hand}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-steel">{p.reserved || ""}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                    p.available <= 0 ? "text-red-700" : low ? "text-amber-700" : ""
                  }`}>
                    {p.available}
                    {low && p.available > 0 && <span className="ml-1 text-[10px] font-medium uppercase">low</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-steel">{p.on_order || ""}</td>
                  {showCost && <td className="px-3 py-2.5 text-right tabular-nums text-steel">{money(p.unit_cost)}</td>}
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(p.unit_price)}</td>
                </ClickRow>,
              ];
            })}
            {parts.length === 0 && (
              <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-steel">
                {q || cat || view !== "all"
                  ? "No parts match."
                  : canEdit ? "No parts yet — use Add a part above." : "No parts yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
