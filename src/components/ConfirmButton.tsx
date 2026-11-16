"use client";

import { useId, useRef } from "react";
import { btn, btnDanger, btnGhost, input, label } from "./ui";

/**
 * A button that asks "Are you sure?" before it does anything. It belongs inside
 * an <ActionForm>: the first click only opens the dialog, and only the
 * confirmation inside it submits the form. Cancelling, pressing Escape or
 * clicking outside the dialog leaves everything as it was.
 *
 * Built on <dialog>, so the page behind it is inert while it is open and focus
 * is kept inside it without any extra machinery.
 */
export function ConfirmButton({
  label: buttonLabel,
  title = "Are you sure?",
  message,
  confirmLabel,
  noteField,
  tone = "danger",
  className,
}: {
  label: string;
  title?: string;
  message: React.ReactNode;
  confirmLabel: string;
  /** If set, the dialog asks for an optional note, sent with the form under this name. */
  noteField?: { name: string; label: string; placeholder?: string };
  tone?: "danger" | "primary";
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const noteId = useId();

  return (
    <>
      <button
        type="button" className={className ?? (tone === "danger" ? btnDanger : btn)}
        onClick={() => ref.current?.showModal()}
      >
        {buttonLabel}
      </button>

      <dialog
        ref={ref}
        // Clicking the dimmed backdrop counts as "no".
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className="w-full max-w-md rounded-xl border border-slate-200 p-0 shadow-xl backdrop:bg-black/40"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-bold">{title}</h2>
          <div className="text-sm text-steel">{message}</div>

          {noteField && (
            <div>
              <label className={label} htmlFor={noteId}>{noteField.label}</label>
              <input
                id={noteId} name={noteField.name} maxLength={500} placeholder={noteField.placeholder}
                className={`${input} w-full`}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={btnGhost} onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <button
              type="submit" className={tone === "danger" ? `${btnDanger} !bg-red-600 !text-white hover:!bg-red-700` : btn}
              onClick={() => ref.current?.close()}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
