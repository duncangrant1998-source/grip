import { requireSession, inShop } from "@/lib/auth";
import { can, departmentsFor, ROLE_LABELS, type Department } from "@/lib/permissions";
import { unreadNotificationCount } from "@/lib/platform-queries";
import { unreadMessageCount } from "@/lib/messaging-queries";
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

  const departments = departmentsFor(session.role, session.extraRoles);
  const [unreadCount, unreadMessages] = await Promise.all([
    session.isPlatformAdmin ? unreadNotificationCount(session) : Promise.resolve(0),
    unreadMessageCount(session),
  ]);

  // Open to every signed-in user regardless of role — messaging a coworker
  // isn't a department permission, it's just being staff at this shop.
  const links: AppNavLink[] = [{ href: "/app", label: "Dashboard" }];
  if (departments.includes("service")) {
    links.push({ href: NAV.service.href, label: NAV.service.label });
  } else if (can(session.role, "workorders.view", session.extraRoles)) {
    links.push({ href: "/app/orders", label: "Work orders" });
  }
  if (departments.includes("parts")) links.push({ href: NAV.parts.href, label: NAV.parts.label });
  if (can(session.role, "customers.view", session.extraRoles)) links.push({ href: "/app/customers", label: "Customers" });
  links.push({ href: "/app/messages", label: "Messages", badge: unreadMessages });
  if (departments.includes("admin")) links.push({ href: NAV.admin.href, label: NAV.admin.label });
  if (can(session.role, "reports.margin", session.extraRoles) || can(session.role, "reports.partsOnly", session.extraRoles)) {
    links.push({ href: "/app/reports", label: can(session.role, "reports.margin", session.extraRoles) ? "Reports" : "Parts sales" });
  }
  if (can(session.role, "settings.manage", session.extraRoles)) links.push({ href: "/app/shop", label: "My Shop" });
  if (can(session.role, "timeclock.own", session.extraRoles)) links.push({ href: "/app/time", label: "Time clock" });
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
