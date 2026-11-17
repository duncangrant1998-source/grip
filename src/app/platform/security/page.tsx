import { requirePlatformAdmin } from "@/lib/auth";
import { listSecurityEvents } from "@/lib/platform-queries";
import { card } from "@/components/ui";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  failed_logins: "Repeated failed sign-ins",
  privilege_grant: "Privilege grant",
};

const KIND_STYLE: Record<string, string> = {
  failed_logins: "bg-red-50 text-red-700",
  privilege_grant: "bg-violet-50 text-violet-700",
};

export default async function SecurityPage() {
  const session = await requirePlatformAdmin();
  const events = await listSecurityEvents(session);

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="font-semibold">Security events</h2>
        <p className="text-xs text-steel">
          Five or more failed sign-ins for one email within 15 minutes, and anyone promoted to
          shop admin or platform admin.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
          <tr>
            <th className="px-4 py-2">When</th>
            <th className="px-4 py-2">Kind</th>
            <th className="px-4 py-2">Shop</th>
            <th className="px-4 py-2">Who</th>
            <th className="px-4 py-2">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {events.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="px-4 py-3 whitespace-nowrap text-steel">{dateTime(e.created_at)}</td>
              <td className="px-4 py-3">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_STYLE[e.kind]}`}>
                  {KIND_LABEL[e.kind]}
                </span>
              </td>
              <td className="px-4 py-3">{e.shop_name ?? "—"}</td>
              <td className="px-4 py-3">{e.user_name ?? (e.details.email as string | undefined) ?? "—"}</td>
              <td className="px-4 py-3 font-mono text-xs text-steel">
                {JSON.stringify(e.details)}
              </td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-steel">Nothing flagged yet.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
