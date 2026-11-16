"use client";

import { useState } from "react";
import { btnGhost, input, label } from "@/components/ui";

type Decoded = {
  vin: string; year: number | null; make: string | null; model: string | null;
  trim: string | null; warning: string | null;
};

/**
 * The vehicle half of every "add a vehicle" form: year, make, model, trim and
 * VIN, with a button that fills the first four from the VIN. `prefix` is how the
 * form's action names these fields ("v_" when a customer is being added at the
 * same time, "" for a vehicle on its own); the mileage field is the odd one out
 * and is named by `mileageName`.
 */
export function VehicleFields({
  prefix = "", mileageName = "current_mileage", idPrefix = "vf", defaults,
}: {
  prefix?: string;
  mileageName?: string;
  idPrefix?: string;
  defaults?: Partial<{ year: string; make: string; model: string; trim: string; vin: string; plate: string; mileage: string }>;
}) {
  const [f, setF] = useState({
    year: defaults?.year ?? "", make: defaults?.make ?? "", model: defaults?.model ?? "",
    trim: defaults?.trim ?? "", vin: defaults?.vin ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const set = (p: Partial<typeof f>) => setF((c) => ({ ...c, ...p }));

  async function decode() {
    const vin = f.vin.trim();
    if (vin.length !== 17) return setNote({ text: "Type the full 17-character VIN first.", bad: true });
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/app/vin?vin=${encodeURIComponent(vin)}`);
      const d = (await res.json()) as Decoded | { error: string };
      if ("error" in d) return setNote({ text: d.error, bad: true });
      set({
        year: d.year ? String(d.year) : f.year,
        make: d.make ?? f.make,
        model: d.model ?? f.model,
        trim: d.trim ?? f.trim,
      });
      setNote({
        text:
          `Filled in from the VIN: ${[d.year, d.make, d.model, d.trim].filter(Boolean).join(" ")}.` +
          (d.trim ? "" : " The VIN doesn't give a trim level; add it if you know it.") +
          (d.warning ? ` Note: ${d.warning}` : ""),
        bad: !!d.warning,
      });
    } catch {
      setNote({ text: "Couldn't reach the VIN lookup. Enter the details by hand.", bad: true });
    } finally {
      setBusy(false);
    }
  }

  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <>
      <div className="sm:col-span-6">
        <label className={label} htmlFor={id("vin")}>VIN</label>
        <div className="flex gap-2">
          <input
            id={id("vin")} name={`${prefix}vin`} value={f.vin} maxLength={17} autoComplete="off"
            onChange={(e) => set({ vin: e.target.value.toUpperCase().replace(/\s/g, "") })}
            onKeyDown={(e) => { if (e.key === "Enter" && f.vin.length === 17) { e.preventDefault(); void decode(); } }}
            placeholder="17 characters — optional"
            className={`${input} w-full font-mono uppercase`}
          />
          <button type="button" onClick={decode} disabled={busy} className={`${btnGhost} whitespace-nowrap`}>
            {busy ? "Looking up…" : "Fill from VIN"}
          </button>
        </div>
        {note && <p className={`mt-1 text-xs ${note.bad ? "text-red-700" : "text-emerald-800"}`}>{note.text}</p>}
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("year")}>Year</label>
        <input id={id("year")} name={`${prefix}year`} value={f.year} inputMode="numeric"
          onChange={(e) => set({ year: e.target.value })} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-4">
        <label className={label} htmlFor={id("make")}>Make</label>
        <input id={id("make")} name={`${prefix}make`} value={f.make}
          onChange={(e) => set({ make: e.target.value })} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-4">
        <label className={label} htmlFor={id("model")}>Model</label>
        <input id={id("model")} name={`${prefix}model`} value={f.model}
          onChange={(e) => set({ model: e.target.value })} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor={id("trim")}>Trim</label>
        <input id={id("trim")} name={`${prefix}trim`} value={f.trim} placeholder="e.g. SE, Limited"
          onChange={(e) => set({ trim: e.target.value })} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor={id("plate")}>Plate</label>
        <input id={id("plate")} name={`${prefix}plate`} defaultValue={defaults?.plate} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-3">
        <label className={label} htmlFor={id("km")}>Mileage (km)</label>
        <input id={id("km")} name={mileageName} defaultValue={defaults?.mileage} inputMode="numeric" className={`${input} w-full`} />
      </div>
    </>
  );
}
