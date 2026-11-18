import Link from "next/link";
import { can, type Role } from "@/lib/permissions";

export type ServiceTab = "schedule" | "quotes" | "open" | "closed" | "shortcuts";

/** The service department's tabs. Server component: the active tab is passed in. */
export function ServiceNav({
  role,
  extraRoles = [],
  active,
}: {
  role: Role;
  extraRoles?: readonly Role[];
  active: ServiceTab;
}) {
  const tabs: { key: ServiceTab; href: string; label: string }[] = [];
  if (can(role, "appointments.view", extraRoles)) tabs.push({ key: "schedule", href: "/app/schedule", label: "Schedule" });
  if (can(role, "workorders.view", extraRoles)) {
    tabs.push(
      { key: "quotes", href: "/app/orders?scope=quotes", label: "Quotes" },
      { key: "open", href: "/app/orders?scope=open", label: "Open orders" },
      { key: "closed", href: "/app/orders?scope=closed", label: "Closed orders" },
    );
  }
  if (can(role, "shortcuts.manage", extraRoles)) tabs.push({ key: "shortcuts", href: "/app/shortcuts", label: "Shortcuts" });

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 text-sm print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 font-medium ${
            active === t.key ? "border-shop text-ink" : "border-transparent text-steel hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
