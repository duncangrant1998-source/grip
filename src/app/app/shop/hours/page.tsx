import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/admin-queries";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { saveCalendar } from "../actions";

export const dynamic = "force-dynamic";

// Ontario is Toronto; the rest are here for a shop that moves or a demo.
const ZONES = [
  "America/Toronto", "America/Winnipeg", "America/Halifax", "America/St_Johns",
  "America/Edmonton", "America/Vancouver", "America/New_York", "America/Chicago",
  "America/Denver", "America/Phoenix", "America/Los_Angeles",
];

function hourLabel(h: number) {
  if (h === 0 || h === 24) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

export default async function HoursPage() {
  const session = await requireSession();
  const s = await getSettings(session);
  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hours</h1>
        <p className="max-w-3xl text-sm text-steel">
          Every time in Grip — appointments, shifts, the time clock and reports — is your
          shop&apos;s own clock, not the clock of whoever happens to be looking.
        </p>
      </div>

      <section className={`${card} p-5`}>
        <ActionForm action={saveCalendar} className="grid gap-3 sm:grid-cols-6" keepAfterSuccess>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="tz">Timezone</label>
            <select id="tz" name="timezone" defaultValue={s.timezone} className={`${input} w-full`}>
              {zones.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="sm:col-span-1">
            <label className={label} htmlFor="oh">Opens</label>
            <select id="oh" name="open_hour" defaultValue={s.open_hour} className={`${input} w-full`}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-1">
            <label className={label} htmlFor="ch">Closes</label>
            <select id="ch" name="close_hour" defaultValue={s.close_hour} className={`${input} w-full`}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-6"><button className={btn}>Save hours</button></div>
        </ActionForm>
        <p className="mt-3 text-xs text-steel">
          Opening hours set how tall the schedule grid is. Work booked outside them still
          shows — the grid stretches rather than hiding it.
        </p>
      </section>
    </div>
  );
}
