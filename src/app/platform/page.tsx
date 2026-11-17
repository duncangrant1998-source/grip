import { requirePlatformAdmin } from "@/lib/auth";
import { listShops } from "@/lib/platform-queries";
import { card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await requirePlatformAdmin();
  // With the platform-admin flag set, RLS lets this one query span tenants.
  // That is the only reason it works; the SQL has no bypass of its own.
  const shops = await listShops(session);

  return (
    <div className={`${card} overflow-hidden`}>
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
          {shops.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-steel">No shops yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
