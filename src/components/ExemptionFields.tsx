"use client";

import { useState } from "react";
import {
  EXEMPT_REASON_LABELS, EXEMPT_REFERENCE_LABELS, exemptNeedsReference,
} from "@/lib/format";
import { input, label } from "./ui";

/**
 * Why a document carries no HST. The label on the number field follows the
 * reason, because "Status card number" and "Purchaser's HST number" are
 * different things and a shop asked for one shouldn't have to guess.
 */
export function ExemptionFields({
  reason, reference, compact = false,
}: {
  reason?: string | null;
  reference?: string | null;
  compact?: boolean;
}) {
  const [picked, setPicked] = useState(reason ?? "");
  const required = picked !== "" && exemptNeedsReference(picked);

  return (
    <div className={compact ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}>
      <div>
        <label className={label} htmlFor="ex-reason">Reason</label>
        <select
          id="ex-reason" name="reason" value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className={`${input} w-full`}
        >
          <option value="">Not recorded</option>
          {Object.entries(EXEMPT_REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="ex-ref">
          {EXEMPT_REFERENCE_LABELS[picked] ?? "Reference"}
          {required && <span className="text-red-600"> *</span>}
        </label>
        <input
          id="ex-ref" name="reference" defaultValue={reference ?? ""} maxLength={60}
          required={required} disabled={picked === ""}
          className={`${input} w-full`}
        />
      </div>
    </div>
  );
}
