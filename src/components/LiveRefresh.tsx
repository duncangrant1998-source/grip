"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a shared document current. When the service advisor and the parts
 * advisor are both on the same work order, each sees the other's lines appear
 * without reloading. A short poll while the tab is visible is enough for a
 * shop floor; it can become a push subscription later without touching the page.
 */
export function LiveRefresh({ everyMs = 6000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      // Don't yank the page out from under someone who is typing.
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      router.refresh();
    };
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);

  return null;
}
