import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listShortcuts } from "@/lib/queries";
import { hours } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ClickRow } from "@/components/ClickRow";
import { ServiceNav } from "@/components/ServiceNav";
import { btn, card, input, label } from "@/components/ui";
import { createShortcut } from "./actions";

export const dynamic = "force-dynamic";

export default async function ShortcutsPage() {
  const session = await requireSession();
  if (!can(session.role, "shortcuts.manage")) redirect("/app?denied=shortcuts");
  const shortcuts = await listShortcuts(session);

  return (
    <div className="space-y-5">
      <ServiceNav role={session.role} active="shortcuts" />
      <div>
        <h1 className="text-2xl font-bold">Service shortcuts</h1>
        <p className="max-w-3xl text-sm text-steel">
          Save the labour and parts for the jobs you do all the time under a short code. Type the
          code on a work order and everything on it is added in one step.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Labour</th>
                <th className="px-4 py-3">Parts</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shortcuts.map((s) => (
                <ClickRow key={s.id} href={`/app/shortcuts/${s.id}`} className={s.is_active ? "" : "opacity-55"}>
                  <td className="px-4 py-3">
                    <Link href={`/app/shortcuts/${s.id}`} className="font-mono font-semibold hover:underline">{s.code}</Link>
                  </td>
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 text-steel">
                    {s.labour_count > 0 ? `${s.labour_count} line${s.labour_count > 1 ? "s" : ""} · ${hours(s.labour_hours)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-steel">
                    {s.part_count > 0 ? `${s.part_count} part${s.part_count > 1 ? "s" : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-steel">{s.is_active ? "Active" : "Inactive"}</td>
                </ClickRow>
              ))}
              {shortcuts.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-steel">
                  No shortcuts yet. Add your first one, like LOF for a lube, oil and filter service.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <section className={`${card} h-fit p-5`}>
          <h2 className="mb-3 font-semibold">New shortcut</h2>
          <ActionForm action={createShortcut} className="space-y-3">
            <div>
              <label className={label} htmlFor="sc-code">Code</label>
              <input id="sc-code" name="code" required maxLength={12} placeholder="LOF"
                className={`${input} w-full font-mono uppercase`} autoComplete="off" />
            </div>
            <div>
              <label className={label} htmlFor="sc-name">Service</label>
              <input id="sc-name" name="name" required maxLength={120} placeholder="Lube, oil and filter change"
                className={`${input} w-full`} />
            </div>
            <button className={btn}>Create and add lines</button>
          </ActionForm>
        </section>
      </div>
    </div>
  );
}
