"use client";

import { usePathname } from "next/navigation";
import { SideNavList } from "@/components/SideNavList";

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
    <SideNavList
      items={TABS.map((t) => ({
        href: t.href,
        label: t.label,
        active: t.exact ? path === t.href : path.startsWith(t.href),
      }))}
    />
  );
}
