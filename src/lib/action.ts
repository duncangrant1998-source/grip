import "server-only";
import { redirect } from "next/navigation";
import { requireSession } from "./auth";
import { can, type Action } from "./permissions";
import type { Session } from "./session";

export type ActionState = { ok?: boolean; error?: string; nonce?: number };

/**
 * Wraps a server action body: session, permission check, and error handling in
 * one place so no action can forget any of them.
 *
 * Errors the database raises on purpose (insufficient stock, an illegal status
 * transition, a unique violation) carry a message written for a human, so those
 * are shown. Anything else is logged and replaced with a generic message —
 * internal errors should not reach the browser.
 */
export async function runAction(
  permission: Action | null,
  fn: (session: Session) => Promise<void>,
): Promise<ActionState> {
  const session = await requireSession();

  if (permission && !can(session.role, permission)) {
    return { error: "You don't have permission to do that." };
  }

  try {
    await fn(session);
    return { ok: true, nonce: Date.now() };
  } catch (err) {
    // redirect() works by throwing; let it through.
    if (isRedirect(err)) throw err;

    const e = err as { code?: string; message?: string; constraint_name?: string };
    if (e.code === "P0001" || e.code === "23514") return { error: e.message ?? "Not allowed." };
    if (e.code === "23505") return { error: "That already exists." };
    // Exclusion violation: someone else booked the same bay or technician at the
    // same instant. The friendly pre-check normally catches this first.
    if (e.code === "23P01") {
      const c = e.constraint_name ?? "";
      if (c.startsWith("time_entries")) return { error: "That overlaps another time entry for this person." };
      if (c.startsWith("shifts")) return { error: "That overlaps another shift for this person." };
      return {
        error: c.includes("tech")
          ? "That technician was just booked for an overlapping time. Pick another time."
          : "That bay was just booked for an overlapping time. Pick another time.",
      };
    }
    if (e.code === "22P02") return { error: "That value isn't valid." };

    console.error("action failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}

function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null &&
    "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

export { redirect };
