"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/parts", label: "Inventory", exact: true },
  { href: "/app/parts/open", label: "Open work orders" },
  { href: "/app/parts/incoming", label: "Incoming work orders" },
  { href: "/app/parts/reorder", label: "Reorder" },
  { href: "/app/parts/orders", label: "Purchase orders" },
  { href: "/app/parts/sales", label: "Counter sales" },
  { href: "/app/parts/suppliers", label: "Suppliers" },
];

export function PartsNav() {
  const path = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 text-sm print:hidden">
      {TABS.map((t) => {
        const active = t.exact
          ? path === t.href || /^\/app\/parts\/[0-9a-f-]{36}/.test(path)
          : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${
              active ? "border-shop text-ink" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
