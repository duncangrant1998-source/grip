"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/shop", label: "Details", exact: true },
  { href: "/app/shop/bays", label: "Bays" },
  { href: "/app/shop/hours", label: "Hours" },
  { href: "/app/shop/pricing", label: "Labour and tax" },
];

export function ShopNav() {
  const path = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 text-sm print:hidden">
      {TABS.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${
              active ? "border-shop text-ink" : "border-transparent text-steel hover:text-ink"
            }`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
