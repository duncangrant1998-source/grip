import { can, type Role } from "@/lib/permissions";
import { SideNavList } from "@/components/SideNavList";

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
    <SideNavList
      items={tabs.map((t) => ({ href: t.href, label: t.label, active: active === t.key }))}
    />
  );
}
