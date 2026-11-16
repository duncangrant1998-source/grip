"use client";

import { useEffect } from "react";

/**
 * Catches anything that escapes a page or action inside /app — most often a
 * dropped connection partway through a server action, since runAction
 * already turns every ordinary failure into an inline message instead of
 * throwing. Lives under /app rather than at the root so the header and nav
 * (defined in this segment's layout.tsx) stay on screen: the person keeps
 * their place and can navigate away, not just retry in place.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("app error boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-steel">
        That may have been a dropped connection. Nothing was lost on this page — you can try again.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
      >
        Try again
      </button>
    </div>
  );
}
