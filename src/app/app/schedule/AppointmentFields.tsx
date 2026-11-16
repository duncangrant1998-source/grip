import { formatDuration } from "@/lib/dates";
import { input, label } from "@/components/ui";

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 360, 480];

type Defaults = {
  date?: string;
  time?: string;
  minutes?: number;
  bay_id?: string | null;
  tech_id?: string | null;
  concern?: string | null;
};

export function AppointmentFields({
  defaults = {},
  bays,
  techs,
}: {
  defaults?: Defaults;
  bays: { id: string; name: string }[];
  techs: { id: string; full_name: string }[];
}) {
  const minutes = defaults.minutes ?? 60;
  // A duration set some other way must still be selectable.
  const durations = DURATIONS.includes(minutes) ? DURATIONS : [...DURATIONS, minutes].sort((a, b) => a - b);

  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className={label} htmlFor="date">Date</label>
        <input id="date" type="date" name="date" required defaultValue={defaults.date} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="time">Start time</label>
        <input id="time" type="time" name="time" required step={300} defaultValue={defaults.time ?? "09:00"} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="minutes">Estimated time</label>
        <select id="minutes" name="minutes" defaultValue={minutes} className={`${input} w-full`}>
          {durations.map((d) => <option key={d} value={d}>{formatDuration(d)}</option>)}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor="bay_id">Bay</label>
        <select id="bay_id" name="bay_id" defaultValue={defaults.bay_id ?? ""} className={`${input} w-full`}>
          <option value="">No bay yet</option>
          {bays.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor="tech_id">Technician</label>
        <select id="tech_id" name="tech_id" defaultValue={defaults.tech_id ?? ""} className={`${input} w-full`}>
          <option value="">Unassigned</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-6">
        <label className={label} htmlFor="concern">What is it coming in for?</label>
        <textarea id="concern" name="concern" rows={2} defaultValue={defaults.concern ?? ""} className={`${input} w-full`}
          placeholder="e.g. Brake noise, oil service, pre-purchase inspection" />
      </div>
    </div>
  );
}
