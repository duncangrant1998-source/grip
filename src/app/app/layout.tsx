import { requireSession, inShop } from "@/lib/auth";
import { can, departmentsFor, ROLE_LABELS, type Department } from "@/lib/permissions";
import { unreadNotificationCount } from "@/lib/platform-queries";
import { AppNav, type AppNavLink } from "@/components/AppNav";
import { Logo } from "@/components/Logo";
import { logout } from "../login/actions";

const NAV: Record<Department, { href: string; label: string }> = {
  service: { href: "/app/service", label: "Service" },
  parts: { href: "/app/parts", label: "Parts" },
  admin: { href: "/app/admin", label: "Administration" },
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  // The shop name comes from the database under the user's own tenant scope.
  // A user can only ever read their own tenants row.
  const [tenant] = await inShop(
    session,
    (tx) => tx<{ name: string }[]>`SELECT name FROM grip.tenants WHERE id = ${session.tenantId}`,
  );

  const departments = departmentsFor(session.role);
  const unreadCount = session.isPlatformAdmin ? await unreadNotificationCount(session) : 0;

  const links: AppNavLink[] = [{ href: "/app", label: "Dashboard" }];
  if (can(session.role, "workorders.view") && !departments.includes("service")) {
    links.push({ href: "/app/orders", label: "Work orders" });
  }
  if (can(session.role, "customers.view")) links.push({ href: "/app/customers", label: "Customers" });
  for (const d of departments) links.push({ href: NAV[d].href, label: NAV[d].label });
  if (can(session.role, "settings.manage")) links.push({ href: "/app/shop", label: "My Shop" });
  if (can(session.role, "reports.margin") || can(session.role, "reports.partsOnly")) {
    links.push({ href: "/app/reports", label: can(session.role, "reports.margin") ? "Reports" : "Parts sales" });
  }
  if (can(session.role, "timeclock.own")) links.push({ href: "/app/time", label: "Time clock" });
  if (session.isPlatformAdmin) links.push({ href: "/platform", label: "Platform", badge: unreadCount });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <AppNav
          logo={<Logo className="h-9" />}
          shopName={tenant?.name}
          links={links}
          fullName={session.fullName}
          roleLabel={session.isPlatformAdmin ? "Platform operator" : ROLE_LABELS[session.role]}
          logoutAction={logout}
        />
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
