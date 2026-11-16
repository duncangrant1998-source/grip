"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/admin", label: "Overview", exact: true },
  { href: "/app/admin/staff", label: "Staff" },
  { href: "/app/admin/shifts", label: "Shifts" },
  { href: "/app/admin/timesheets", label: "Timesheets" },
  { href: "/app/admin/timeoff", label: "Time off" },
  { href: "/app/reports", label: "Reports" },
];

export function AdminNav() {
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
