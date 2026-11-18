import { requirePlatformAdmin } from "@/lib/auth";
import { listShops } from "@/lib/platform-queries";
import { card } from "@/components/ui";
import { dateTime, date } from "@/lib/format";

export const dynamic = "force-dynamic";

// Shops registered somewhere other than Ontario no longer sit under GRIP's
// provincial business license — worth a visible flag, not a silent fact.
function outOfProvince(province: string | null): boolean {
  if (!province) return false;
  const p = province.trim().toLowerCase();
  return p !== "on" && p !== "ontario";
}

export default async function PlatformPage() {
  const session = await requirePlatformAdmin();
  // Counts and activity come from grip.platform_shop_stats(), an aggregate
  // function — this page never reads a shop's customers, work orders, or
  // staff directly, and can't without that shop granting access first.
  const shops = await listShops(session);

  return (
    <div className={`${card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
          <tr>
            <th className="px-4 py-3">Shop</th>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Location</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Trial ends</th>
            <th className="px-4 py-3 text-right">Users</th>
            <th className="px-4 py-3 text-right">Orders</th>
            <th className="px-4 py-3 text-right">Orders / 30d</th>
            <th className="px-4 py-3">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shops.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3 font-medium">{s.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-steel">{s.slug}</td>
              <td className="px-4 py-3">
                {s.city || s.province ? (
                  <span className={outOfProvince(s.province) ? "font-medium text-amber-700" : ""}>
                    {[s.city, s.province].filter(Boolean).join(", ")}
                    {outOfProvince(s.province) && " — outside ON"}
                  </span>
                ) : (
                  <span className="text-steel">—</span>
                )}
              </td>
              <td className="px-4 py-3">{s.plan}</td>
              <td className="px-4 py-3">{s.status}</td>
              <td className="px-4 py-3 text-steel">{s.trial_ends_at ? date(s.trial_ends_at) : "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{s.users}</td>
              <td className="px-4 py-3 text-right tabular-nums">{s.orders}</td>
              <td className="px-4 py-3 text-right tabular-nums">{s.orders_last_30d}</td>
              <td className="px-4 py-3 text-steel">{s.last_activity_at ? dateTime(s.last_activity_at) : "never"}</td>
            </tr>
          ))}
          {shops.length === 0 && (
            <tr><td colSpan={10} className="px-4 py-8 text-center text-steel">No shops yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
