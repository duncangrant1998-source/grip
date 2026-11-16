"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { btn, btnDanger, input, label } from "@/components/ui";
import { addLabour, addShortcutParts, removeLabour, updateLabour } from "../actions";

/**
 * Labour you can simply type into.
 *
 * Every field on a line is a live text box. Nothing has to be opened first and
 * there is no Save button: a change is sent when focus leaves the line (or the
 * moment a checkbox or dropdown is flipped), and the line says so. A line that
 * fails to save keeps what was typed and says why, rather than snapping back.
 */

type Mode = "flat_rate" | "straight_time";

export type LabourLineData = {
  id: string; description: string; billed_hours: string; actual_hours: string;
  rate: string; billing_mode: Mode; tech_id: string | null; is_taxable: boolean;
};

type Fields = {
  description: string; hours: string; actual: string; rate: string; amount: string;
  mode: Mode; taxable: boolean; tech: string;
};

const num = (s: string) => Number(s.replace(/,/g, "").trim());
const money2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "");
const hrs = (s: string) => String(Number(s));          // "2.40" -> "2.4"

function initial(l: LabourLineData): Fields {
  return {
    description: l.description,
    hours: hrs(l.billed_hours),
    actual: hrs(l.actual_hours),
    rate: money2(Number(l.rate)),
    amount: money2(Number(l.billed_hours) * Number(l.rate)),
    mode: l.billing_mode,
    taxable: l.is_taxable,
    tech: l.tech_id ?? "",
  };
}

const cell = `${input} w-full px-2 py-1.5 text-right tabular-nums`;

export function LabourRow({
  orderId, line, provenance, editable, isTech, techs,
}: {
  orderId: string;
  line: LabourLineData;
  provenance: { label: "Added by" | "Edited by"; name: string | null; at: string };
  editable: boolean;
  isTech: boolean;
  techs: { id: string; full_name: string }[];
}) {
  const [f, setF] = useState<Fields>(() => initial(line));
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  // Pick up changes made elsewhere (another desk, a refresh) — but never on top
  // of something the person is in the middle of typing.
  const serverSig = JSON.stringify(initial(line));
  const lastSig = useRef(serverSig);
  useEffect(() => {
    if (serverSig === lastSig.current) return;
    lastSig.current = serverSig;
    if (!dirty.current) setF(initial(line));
  }, [serverSig, line]);

  const set = (patch: Partial<Fields>) => {
    dirty.current = true;
    setF((cur) => ({ ...cur, ...patch }));
  };

  // Hours and rate drive the amount; the amount, edited directly, drives the rate.
  const onHours = (v: string) => {
    const hours = num(v);
    set({
      hours: v,
      amount: money2(hours * num(f.rate)),
      actual: f.mode === "straight_time" ? v : f.actual,
    });
  };
  const onRate = (v: string) => set({ rate: v, amount: money2(num(f.hours) * num(v)) });
  const onAmount = (v: string) => {
    const hours = num(f.hours);
    // With no hours there is nothing to divide by; keep what was typed and let
    // the save explain.
    set({ amount: v, rate: hours > 0 ? money2(num(v) / hours) : f.rate });
  };
  const onMode = (mode: Mode) => {
    const next = { ...f, mode, actual: mode === "straight_time" ? f.hours : f.actual };
    dirty.current = true;
    setF(next);
    save(next);
  };
  const onTaxable = (taxable: boolean) => {
    const next = { ...f, taxable };
    dirty.current = true;
    setF(next);
    save(next);
  };
  const onTech = (tech: string) => {
    const next = { ...f, tech };
    dirty.current = true;
    setF(next);
    save(next);
  };

  function save(values: Fields = f) {
    if (!dirty.current) return;
    const hours = num(values.hours);
    const rate = num(values.rate);
    const actual = values.actual.trim() === "" ? NaN : num(values.actual);

    if (values.description.trim() === "") return setError("Describe the work.");
    if (!Number.isFinite(hours) || hours < 0) return setError("Hours must be a number, 0 or more.");
    if (!Number.isFinite(rate) || rate < 0) return setError("Rate must be a number, 0 or more.");
    if (values.mode === "flat_rate" && values.actual.trim() !== "" && (!Number.isFinite(actual) || actual < 0)) {
      return setError("Actual hours must be a number, 0 or more.");
    }
    if (num(values.amount) > 0 && hours === 0) {
      return setError("Enter the hours first — the amount is hours × rate.");
    }

    const fd = new FormData();
    fd.set("work_order_id", orderId);
    fd.set("line_id", line.id);
    fd.set("description", values.description);
    fd.set("hours", String(hours));
    if (Number.isFinite(actual)) fd.set("actual_hours", String(actual));
    fd.set("rate", String(rate));
    fd.set("mode", values.mode);
    if (values.tech) fd.set("tech_id", values.tech);
    if (values.taxable) fd.set("taxable", "on");

    setError(null);
    setStatus("saving");
    startTransition(async () => {
      const r = await updateLabour({}, fd);
      if (r.error) {
        setStatus("idle");
        setError(r.error);
      } else {
        dirty.current = false;
        setStatus("saved");
      }
    });
  }

  const locked = !editable;
  const straight = f.mode === "straight_time";

  return (
    <tr
      className="align-top"
      onBlur={(e) => {
        // Save when focus leaves the line, not on every hop between its boxes.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
      }}
    >
      <td className="px-5 py-3">
        <input
          value={f.description} onChange={(e) => set({ description: e.target.value })}
          disabled={locked} maxLength={300} aria-label="Work description"
          className={`${input} w-full font-medium`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-steel">
          <select
            value={f.mode} onChange={(e) => onMode(e.target.value as Mode)}
            disabled={locked || isTech} aria-label="Billing"
            className={`${input} px-2 py-1 text-xs`}
          >
            <option value="flat_rate">Flat rate</option>
            <option value="straight_time">Straight time</option>
          </select>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox" checked={f.taxable} onChange={(e) => onTaxable(e.target.checked)}
              disabled={locked || isTech}
            /> Taxable
          </label>
          {!isTech && (
            <select
              value={f.tech} onChange={(e) => onTech(e.target.value)}
              disabled={locked} aria-label="Technician"
              className={`${input} px-2 py-1 text-xs`}
            >
              <option value="">Unassigned</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          )}
          <span aria-live="polite" className="min-h-4">
            {status === "saving" && "Saving…"}
            {status === "saved" && !error && <span className="text-emerald-700">Saved</span>}
          </span>
        </div>
        {error && <p role="alert" className="mt-1.5 text-xs text-red-700">{error}</p>}
      </td>
      <td className="w-24 px-3 py-3">
        <input value={f.hours} onChange={(e) => onHours(e.target.value)} inputMode="decimal"
          disabled={locked} aria-label="Billed hours" className={cell} />
      </td>
      <td className="w-24 px-3 py-3">
        <input value={straight ? f.hours : f.actual} onChange={(e) => set({ actual: e.target.value })}
          inputMode="decimal" disabled={locked || straight} aria-label="Actual hours"
          title={straight ? "Straight time bills the hours worked, so this follows Billed hours" : undefined}
          className={`${cell} ${straight ? "text-steel" : ""}`} />
      </td>
      <td className="w-28 px-3 py-3">
        <input value={f.rate} onChange={(e) => onRate(e.target.value)} inputMode="decimal"
          disabled={locked || isTech} aria-label="Rate" className={cell} />
      </td>
      <td className="w-32 px-3 py-3">
        <input value={f.amount} onChange={(e) => onAmount(e.target.value)} inputMode="decimal"
          disabled={locked || isTech} aria-label="Amount"
          title="Edit this and the rate is worked out from the hours"
          className={`${cell} font-medium`} />
      </td>
      <td className="px-5 py-3 text-xs text-steel">
        <div>{provenance.label} {provenance.name ?? "—"}</div>
        <div>{provenance.at}</div>
        {editable && (
          <ActionForm action={removeLabour} className="mt-1.5">
            <input type="hidden" name="work_order_id" value={orderId} />
            <input type="hidden" name="line_id" value={line.id} />
            <button className={btnDanger}>Delete</button>
          </ActionForm>
        )}
      </td>
    </tr>
  );
}

type Found = {
  found: true; code: string; name: string; description: string; hours: number;
  rate: string | null; mode: Mode | null; taxable: boolean; lines: number; parts: number;
};

export function AddLabourForm({
  orderId, defaultMode, isTech, techs, shopRate,
}: {
  orderId: string;
  defaultMode: Mode;
  isTech: boolean;
  techs: { id: string; full_name: string }[];
  shopRate: string;
}) {
  const blank = {
    abv: "", description: "", hours: "", actual: "", rate: "", mode: defaultMode as Mode,
    tech: "", taxable: true,
  };
  const [f, setF] = useState(blank);
  const [hint, setHint] = useState<{ text: string; bad?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The shortcut whose labour is on the form, if it also has parts to add with it.
  const [withParts, setWithParts] = useState<string | null>(null);
  const descRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<typeof blank>) => setF((cur) => ({ ...cur, ...p }));

  async function lookup(code: string) {
    const c = code.trim();
    if (!c) return setHint(null);
    try {
      const res = await fetch(`/app/orders/shortcut?code=${encodeURIComponent(c)}`);
      const data = (await res.json()) as Found | { found: false };
      if (!data.found) return setHint({ text: `No shortcut with the code "${c.toUpperCase()}".`, bad: true });

      setWithParts(data.parts > 0 ? data.code : null);
      patch({
        abv: data.code,
        description: data.description,
        hours: String(data.hours),
        rate: data.rate ?? "",
        mode: data.mode ?? f.mode,
        taxable: data.taxable,
        actual: "",
      });
      setHint({
        text: `${data.code} — ${data.name}.` +
          (data.parts > 0
            ? ` Adding it also puts its ${data.parts} saved part${data.parts === 1 ? "" : "s"} on the order.`
            : ""),
      });
      descRef.current?.focus();
    } catch {
      setHint({ text: "Couldn't look that code up. Check your connection.", bad: true });
    }
  }

  function submit() {
    const hours = num(f.hours);
    if (f.description.trim() === "") return setError("Describe the work.");
    if (!Number.isFinite(hours) || hours < 0) return setError("Enter the hours, 0 or more.");

    const fd = new FormData();
    fd.set("work_order_id", orderId);
    fd.set("description", f.description);
    fd.set("hours", String(hours));
    if (f.actual.trim() !== "") fd.set("actual_hours", String(num(f.actual)));
    if (f.rate.trim() !== "") fd.set("rate", String(num(f.rate)));
    fd.set("mode", f.mode);
    if (f.tech) fd.set("tech_id", f.tech);
    if (f.taxable) fd.set("taxable", "on");

    setError(null);
    setPending(true);
    startTransition(async () => {
      const r = await addLabour({}, fd);
      setPending(false);
      if (r.error) return setError(r.error);
      if (withParts) {
        const pf = new FormData();
        pf.set("work_order_id", orderId);
        pf.set("code", withParts);
        const pr = await addShortcutParts({}, pf);
        if (pr.error) setError(`The labour was added, but the parts weren't: ${pr.error}`);
      }
      setWithParts(null);
      setF({ ...blank, mode: f.mode });
      setHint(null);
    });
  }

  const straight = f.mode === "straight_time";

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!pending) submit(); }}
      className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:grid-cols-12"
    >
      <div className="sm:col-span-2">
        <label className={label} htmlFor="l-abv">ABV</label>
        <input
          id="l-abv" value={f.abv} maxLength={12} autoComplete="off" placeholder="LOF"
          onChange={(e) => { setWithParts(null); patch({ abv: e.target.value.toUpperCase() }); }}
          onBlur={(e) => { if (e.target.value.trim()) void lookup(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(f.abv); } }}
          className={`${input} w-full font-mono uppercase`}
        />
      </div>
      <div className="sm:col-span-10">
        <label className={label} htmlFor="l-desc">Description</label>
        <input
          id="l-desc" ref={descRef} value={f.description} maxLength={300}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="e.g. Replace front brake pads and rotors" className={`${input} w-full`}
        />
      </div>
      {hint && (
        <p className={`text-xs sm:col-span-12 ${hint.bad ? "text-red-700" : "text-steel"}`}>{hint.text}</p>
      )}
      <div className="sm:col-span-2">
        <label className={label} htmlFor="l-mode">Billing</label>
        <select id="l-mode" value={f.mode} onChange={(e) => patch({ mode: e.target.value as Mode })}
          className={`${input} w-full`}>
          <option value="flat_rate">Flat rate</option>
          <option value="straight_time">Straight time</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="l-hours">Hours</label>
        <input id="l-hours" value={f.hours} onChange={(e) => patch({ hours: e.target.value })}
          inputMode="decimal" className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="l-actual">
          Actual hrs <span className="text-slate-400">(flat rate)</span>
        </label>
        <input id="l-actual" value={straight ? f.hours : f.actual}
          onChange={(e) => patch({ actual: e.target.value })} disabled={straight}
          inputMode="decimal" className={`${input} w-full`} />
      </div>
      {!isTech && (
        <>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="l-rate">Rate</label>
            <input id="l-rate" value={f.rate} onChange={(e) => patch({ rate: e.target.value })}
              inputMode="decimal" placeholder={shopRate} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="l-tech">Technician</label>
            <select id="l-tech" value={f.tech} onChange={(e) => patch({ tech: e.target.value })}
              className={`${input} w-full`}>
              <option value="">Unassigned</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="flex items-end gap-3 sm:col-span-12">
        {!isTech && (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={f.taxable} onChange={(e) => patch({ taxable: e.target.checked })} /> Taxable
          </label>
        )}
        <button className={btn} disabled={pending}>{pending ? "Adding…" : "Add labour"}</button>
        {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      </div>
      <p className="text-xs text-steel sm:col-span-12">
        Type a shortcut code in ABV and the description, hours and rate fill themselves in; change
        anything you like before adding. Its parts are added with it. Every box on a line stays editable afterwards.
      </p>
    </form>
  );
}
