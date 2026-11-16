"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const CONNECTION_ERROR =
  "Couldn't reach the server — this wasn't saved. Check your connection and try again.";

/**
 * True for the thrown value Next.js's client runtime uses to perform a
 * redirect a server action requested. Everything else that reaches here
 * uncaught is, by construction of this app's actions (see runAction, which
 * already turns every server-side failure into a returned `{ error }`), not
 * an application error — it's the request failing to reach the server, or
 * its response failing to come back. Those read as a dropped connection, not
 * a redirect, so they're the only other case this catches.
 */
function isRedirectThrow(err: unknown): boolean {
  return typeof err === "object" && err !== null &&
    "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

/**
 * A form bound to a server action that shows the action's error inline, dims itself
 * while submitting, and clears itself after a success.
 *
 * It deliberately does NOT use <form action={...}>. React 19 resets every uncontrolled
 * field after such an action finishes — even when the action came back with a
 * validation error — so one mistyped field would wipe everything the person had typed.
 * Submitting through a transition instead keeps the fields until we decide to clear them.
 *
 * Every submission also carries a hidden, per-submission random key
 * (`_idemKey`). Most actions ignore it; a handful of "create" actions use it
 * (see src/lib/idempotency.ts) to recognise a retried submission — one where
 * the connection dropped after the server finished but before the response
 * got back — and return the original result instead of creating a duplicate.
 * The key only rotates after a confirmed success, so a retry of the same
 * submission (the connection-drop case below) reuses it on purpose.
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
  const safeAction: Action = async (prev, form) => {
    try {
      return await action(prev, form);
    } catch (err) {
      if (isRedirectThrow(err)) throw err;
      return { error: CONNECTION_ERROR };
    }
  };

  const [state, dispatch, pending] = useActionState(safeAction, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (state.ok) {
      setIdemKey(crypto.randomUUID());
      if (!keepAfterSuccess) ref.current?.reset();
    }
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
        data.set("_idemKey", idemKey);
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
