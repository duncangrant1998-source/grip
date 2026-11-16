import Link from "next/link";
import { requirePlatformAdmin, inShop } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await requirePlatformAdmin();

  // With the platform-admin flag set, RLS lets this one query span tenants.
  // That is the only reason it works; the SQL has no bypass of its own.
  const shops = await inShop(
    session,
    (tx) => tx<
      { id: string; name: string; slug: string; plan: string; status: string; users: string; orders: string }[]
    >`
      SELECT t.id, t.name, t.slug, t.plan, t.status,
             (SELECT count(*) FROM grip.users u WHERE u.tenant_id = t.id) AS users,
             (SELECT count(*) FROM grip.work_orders w WHERE w.tenant_id = t.id) AS orders
      FROM grip.tenants t
      ORDER BY t.created_at`,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">All shops</h1>
        <Link href="/app" className="text-sm text-steel hover:text-ink">
          ← Back to portal
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Users</th>
              <th className="px-4 py-3 text-right">Work orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shops.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-steel">{s.slug}</td>
                <td className="px-4 py-3">{s.plan}</td>
                <td className="px-4 py-3">{s.status}</td>
                <td className="px-4 py-3 text-right tabular-nums">{s.users}</td>
                <td className="px-4 py-3 text-right tabular-nums">{s.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
