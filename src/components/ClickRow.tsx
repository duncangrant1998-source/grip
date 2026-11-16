"use client";

import { useRouter } from "next/navigation";

/**
 * A table row that opens `href` when clicked anywhere on it. Links, buttons and
 * form fields inside the row keep their own behaviour, and the row stays usable
 * from the keyboard through the link in its first cell.
 */
export function ClickRow({
  href, className = "", children,
}: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer hover:bg-slate-50 ${className}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, summary")) return;
        if (window.getSelection()?.toString()) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
