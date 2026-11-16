"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A form bound to a server action that shows the action's error inline, dims itself
 * while submitting, and clears itself after a success.
 *
 * It deliberately does NOT use <form action={...}>. React 19 resets every uncontrolled
 * field after such an action finishes — even when the action came back with a
 * validation error — so one mistyped field would wipe everything the person had typed.
 * Submitting through a transition instead keeps the fields until we decide to clear them.
 */
export function ActionForm({
  action,
  children,
  className,
  keepAfterSuccess = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  keepAfterSuccess?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && !keepAfterSuccess) ref.current?.reset();
  }, [state.ok, state.nonce, keepAfterSuccess]);

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const form = e.currentTarget;
        // Include the clicked submit button's name/value, as a native submit would.
        let data: FormData;
        try {
          data = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
        } catch {
          data = new FormData(form);
        }
        startTransition(() => dispatch(data));
      }}
      aria-busy={pending}
      className={`${className ?? ""} ${pending ? "pointer-events-none opacity-60" : ""}`}
    >
      {children}
      {state.error && (
        <p role="alert" className="mt-2 w-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
