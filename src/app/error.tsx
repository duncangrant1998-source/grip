"use client";

import { useEffect } from "react";

/**
 * Root fallback for anything outside /app (marketing pages, login) that
 * escapes uncaught — most plausibly a dropped connection during sign-in.
 * /app has its own error.tsx that keeps the header and nav on screen; this
 * one is the generic page-level fallback everywhere else.
 *
 * error.tsx must be a Client Component, so it can't render the real `Logo`
 * (it reads the filesystem to decide whether a logo image exists, which is
 * server-only) — this uses the same plain-text fallback Logo itself falls
 * back to when there's no image on disk.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("root error boundary:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-sm font-bold tracking-widest text-shop">GRIP</span>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-steel">
        That may have been a dropped connection. Check your connection and try again.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
      >
        Try again
      </button>
    </main>
  );
}
