"use client";

import { usePathname } from "next/navigation";
import { SideNavList } from "@/components/SideNavList";

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
    <SideNavList
      items={TABS.map((t) => ({
        href: t.href,
        label: t.label,
        active: t.exact
          ? path === t.href || /^\/app\/parts\/[0-9a-f-]{36}/.test(path)
          : path.startsWith(t.href),
      }))}
    />
  );
}
