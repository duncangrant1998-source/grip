"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/platform", label: "Shops", exact: true },
  { href: "/platform/support", label: "Support" },
  { href: "/platform/security", label: "Security" },
  { href: "/platform/payments", label: "Payments" },
  { href: "/platform/addons", label: "Add-ons" },
  { href: "/platform/notifications", label: "Notifications" },
];

export function PlatformNav({ unreadCount }: { unreadCount: number }) {
  const path = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 text-sm print:hidden">
      {TABS.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        const showBadge = t.href === "/platform/notifications" && unreadCount > 0;
        return (
          <Link key={t.href} href={t.href}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium ${
              active ? "border-shop text-ink" : "border-transparent text-steel hover:text-ink"
            }`}>
            {t.label}
            {showBadge && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
