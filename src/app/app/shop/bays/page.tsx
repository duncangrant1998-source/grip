import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listBaysWithUsage } from "@/lib/schedule-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnDanger, btnGhost, card, input, label } from "@/components/ui";
import { addBay, deleteBay, updateBay } from "../actions";

export const dynamic = "force-dynamic";

export default async function BaysPage() {
  const session = await requireSession();
  const bays = await listBaysWithUsage(session);
  const inUse = bays.filter((b) => b.is_active).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bays</h1>
        <p className="max-w-3xl text-sm text-steel">
          The lifts and stalls appointments are booked into. {inUse} in use.{" "}
          A bay nothing has been booked into can be deleted outright; once it has work on
          record, retire it instead so that work keeps its bay. Retired bays leave the{" "}
          <Link href="/app/schedule" className="underline hover:text-ink">schedule</Link> but
          stay on the jobs that used them.
        </p>
      </div>

      <div className={`${card} divide-y divide-slate-100`}>
        {bays.map((b) => (
          <div key={b.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${b.is_active ? "" : "bg-slate-50"}`}>
            <ActionForm action={updateBay} className="flex flex-wrap items-center gap-3" keepAfterSuccess>
              <input type="hidden" name="id" value={b.id} />
              <input name="name" defaultValue={b.name} aria-label="Bay name" className={`${input} w-56`} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={b.is_active} /> In use
              </label>
              <button className={btnGhost}>Save</button>
            </ActionForm>

            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-steel">
                {b.appointments === 0
                  ? "never booked"
                  : `${b.appointments} appointment${b.appointments === 1 ? "" : "s"}`}
                {b.upcoming > 0 && ` · ${b.upcoming} upcoming`}
              </span>
              <ActionForm action={deleteBay}>
                <input type="hidden" name="id" value={b.id} />
                <button
                  className={btnDanger}
                  title={b.appointments === 0
                    ? "Delete this bay"
                    : "This bay has work on record — retire it instead by unticking In use"}
                >
                  Delete
                </button>
              </ActionForm>
            </div>
          </div>
        ))}
        {bays.length === 0 && (
          <p className="p-6 text-center text-sm text-steel">
            No bays yet. Add one for each lift or stall you book work into.
          </p>
        )}
      </div>

      <ActionForm action={addBay} className={`${card} flex items-end gap-3 p-5`}>
        <div className="flex-1">
          <label className={label} htmlFor="bay-name">Add a bay</label>
          <input id="bay-name" name="name" placeholder="e.g. Bay 3, Alignment rack, Dyno" className={`${input} w-full`} />
        </div>
        <button className={btn}>Add</button>
      </ActionForm>
    </div>
  );
}
