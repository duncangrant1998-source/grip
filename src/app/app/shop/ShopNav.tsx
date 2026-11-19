"use client";

import { usePathname } from "next/navigation";
import { SideNavList } from "@/components/SideNavList";

const TABS = [
  { href: "/app/shop", label: "Details", exact: true },
  { href: "/app/shop/bays", label: "Bays" },
  { href: "/app/shop/hours", label: "Hours" },
  { href: "/app/shop/pricing", label: "Labour and tax" },
];

export function ShopNav() {
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
