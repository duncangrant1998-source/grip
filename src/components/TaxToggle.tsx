"use client";

import { startTransition, useState } from "react";
import type { ActionState } from "@/lib/action";

/**
 * A checkbox that applies itself: flipping it sends the change straight away,
 * and puts it back with the reason if the change is refused. Used for the tax
 * switch on a single part line.
 */
export function TaxToggle({
  action, fields, checked, disabled, label = "Tax",
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  checked: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Follow the server when it changes (another desk, a refresh).
  const [seen, setSeen] = useState(checked);
  if (seen !== checked) { setSeen(checked); setOn(checked); }

  function change(next: boolean) {
    setOn(next);
    setError(null);
    setPending(true);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (next) fd.set("taxable", "on");
    startTransition(async () => {
      const r = await action({}, fd);
      setPending(false);
      if (r.error) { setOn(!next); setError(r.error); }
    });
  }

  return (
    <label className={`inline-flex items-center gap-1.5 text-xs ${disabled ? "text-slate-400" : "text-steel"}`}>
      <input
        type="checkbox" checked={on} disabled={disabled || pending}
        onChange={(e) => change(e.target.checked)}
        aria-label={`${label}: charge tax on this line`}
      />
      {label}
      {error && <span role="alert" className="ml-1 text-red-700">{error}</span>}
    </label>
  );
}
