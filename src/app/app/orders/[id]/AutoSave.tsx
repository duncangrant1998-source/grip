"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { input, label } from "@/components/ui";
import { saveOrderDetails, saveOrderNotes } from "../actions";

/**
 * Text that saves itself. Both editors send what was typed when focus leaves
 * them, say so, and keep the text on screen with the reason if the save fails.
 */

function useSaved() {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  return { status, setStatus, error, setError };
}

function Status({ status, error }: { status: string; error: string | null }) {
  return (
    <span aria-live="polite" className="text-xs">
      {error
        ? <span role="alert" className="text-red-700">{error}</span>
        : status === "saving" ? <span className="text-steel">Saving…</span>
        : status === "saved" ? <span className="text-emerald-700">Saved</span>
        : null}
    </span>
  );
}

/** The notes the advisor writes for the customer. */
export function NotesBox({
  orderId, value, editable,
}: { orderId: string; value: string | null; editable: boolean }) {
  const [text, setText] = useState(value ?? "");
  const { status, setStatus, error, setError } = useSaved();
  const dirty = useRef(false);
  const last = useRef(value ?? "");

  useEffect(() => {
    const incoming = value ?? "";
    if (incoming === last.current) return;
    last.current = incoming;
    if (!dirty.current) setText(incoming);
  }, [value]);

  function save() {
    if (!dirty.current) return;
    const fd = new FormData();
    fd.set("work_order_id", orderId);
    fd.set("notes", text);
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      const r = await saveOrderNotes({}, fd);
      if (r.error) { setStatus("idle"); setError(r.error); return; }
      dirty.current = false;
      last.current = text.trim();
      setStatus("saved");
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className={label} htmlFor="order-notes">Notes</label>
        <Status status={status} error={error} />
      </div>
      <textarea
        id="order-notes" value={text} rows={4} maxLength={5000} disabled={!editable}
        onChange={(e) => { dirty.current = true; setText(e.target.value); }}
        onBlur={save}
        placeholder="Anything the customer should know — findings, recommendations, what to watch for. Printed on the quote and invoice."
        className={`${input} w-full`}
      />
    </div>
  );
}

/** The customer's concern and the mileage in, corrected right on the order. */
export function DetailsEditor({
  orderId, concern, mileage, editable,
}: { orderId: string; concern: string | null; mileage: number | null; editable: boolean }) {
  const [c, setC] = useState(concern ?? "");
  const [m, setM] = useState(mileage != null ? String(mileage) : "");
  const { status, setStatus, error, setError } = useSaved();
  const dirty = useRef(false);
  const sig = `${concern ?? ""}|${mileage ?? ""}`;
  const last = useRef(sig);

  useEffect(() => {
    if (sig === last.current) return;
    last.current = sig;
    if (!dirty.current) { setC(concern ?? ""); setM(mileage != null ? String(mileage) : ""); }
  }, [sig, concern, mileage]);

  function save() {
    if (!dirty.current) return;
    const fd = new FormData();
    fd.set("work_order_id", orderId);
    fd.set("concern", c);
    fd.set("mileage_in", m);
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      const r = await saveOrderDetails({}, fd);
      if (r.error) { setStatus("idle"); setError(r.error); return; }
      dirty.current = false;
      setStatus("saved");
    });
  }

  return (
    <div
      className="grid max-w-4xl gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save(); }}
    >
      <div>
        <label className={label} htmlFor="order-concern">Customer concern</label>
        <textarea
          id="order-concern" value={c} rows={2} maxLength={2000} disabled={!editable}
          onChange={(e) => { dirty.current = true; setC(e.target.value); }}
          placeholder="What is the customer reporting?" className={`${input} w-full`}
        />
      </div>
      <div>
        <label className={label} htmlFor="order-mileage">Mileage in (km)</label>
        <input
          id="order-mileage" value={m} inputMode="numeric" disabled={!editable}
          onChange={(e) => { dirty.current = true; setM(e.target.value); }}
          className={`${input} w-full`}
        />
      </div>
      <div className="sm:col-span-2"><Status status={status} error={error} /></div>
    </div>
  );
}
