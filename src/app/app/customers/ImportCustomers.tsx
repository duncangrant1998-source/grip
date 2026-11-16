"use client";

import { startTransition, useActionState } from "react";
import { btn, input } from "@/components/ui";
import { importCustomers, type ImportState } from "./actions";

/**
 * Not an ActionForm: this one keeps its result on screen afterwards, because
 * the report is the whole point — a shop needs to see what went in and what
 * did not before it trusts the import.
 */
export function ImportCustomers() {
  const [state, dispatch, pending] = useActionState(importCustomers, {} as ImportState);

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => dispatch(data));
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="min-w-72 flex-1">
          <input
            type="file" name="file" accept=".csv,text/csv" required
            aria-label="Customer CSV file"
            className={`${input} w-full file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm`}
          />
        </div>
        <button className={btn} disabled={pending}>{pending ? "Importing…" : "Import"}</button>
      </form>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      {state.report && (
        <div role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="font-medium">
            {state.report.customersAdded} customer{state.report.customersAdded === 1 ? "" : "s"} and{" "}
            {state.report.vehiclesAdded} vehicle{state.report.vehiclesAdded === 1 ? "" : "s"} added.
            {state.report.customersMatched > 0 &&
              ` ${state.report.customersMatched} already on file, left as they were.`}
          </p>
          {state.report.skipped.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs">
                {state.report.skipped.length} row{state.report.skipped.length === 1 ? "" : "s"} skipped
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {state.report.skipped.map((s) => (
                  <li key={s.row}>Line {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
