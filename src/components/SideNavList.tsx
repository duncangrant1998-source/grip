import Link from "next/link";
import { card } from "@/components/ui";

export type SideNavItem = {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
};

/**
 * The vertical sub-navigation used inside a SectionShell's sidebar (Parts,
 * Administration, My Shop, Service, Time clock). Scrolls horizontally as a
 * single row on narrow screens — where it sits above the content rather
 * than beside it — and stacks into a proper sidebar list from `lg` up.
 */
export function SideNavList({ items }: { items: SideNavItem[] }) {
  return (
    <nav
      className={`${card} flex gap-1 overflow-x-auto p-1.5 text-sm print:hidden lg:sticky lg:top-20 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:p-2`}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3.5 py-2.5 font-medium transition lg:whitespace-normal ${
            item.active
              ? "bg-shop/10 text-shop"
              : "text-steel hover:bg-slate-50 hover:text-ink"
          }`}
        >
          {item.label}
          {!!item.badge && (
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {item.badge}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
