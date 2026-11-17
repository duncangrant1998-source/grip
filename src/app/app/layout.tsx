import Link from "next/link";
import { requireSession, inShop } from "@/lib/auth";
import { can, departmentsFor, ROLE_LABELS, type Department } from "@/lib/permissions";
import { unreadNotificationCount } from "@/lib/platform-queries";
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-[1800px] items-center gap-6 px-8 py-3">
          <Link href="/app" className="shrink-0" aria-label="Grip — dashboard">
            <Logo className="h-9" />
          </Link>
          <div className="text-sm font-semibold">{tenant?.name}</div>

          <nav className="ml-4 flex flex-wrap gap-1 text-sm">
            <NavLink href="/app">Dashboard</NavLink>
            {can(session.role, "workorders.view") && !departments.includes("service") && (
              <NavLink href="/app/orders">Work orders</NavLink>
            )}
            {can(session.role, "customers.view") && <NavLink href="/app/customers">Customers</NavLink>}
            {departments.map((d) => (
              <NavLink key={d} href={NAV[d].href}>
                {NAV[d].label}
              </NavLink>
            ))}
            {can(session.role, "settings.manage") && <NavLink href="/app/shop">My Shop</NavLink>}
            {(can(session.role, "reports.margin") || can(session.role, "reports.partsOnly")) && (
              <NavLink href="/app/reports">{can(session.role, "reports.margin") ? "Reports" : "Parts sales"}</NavLink>
            )}
            {can(session.role, "timeclock.own") && <NavLink href="/app/time">Time clock</NavLink>}
            {session.isPlatformAdmin && (
              <NavLink href="/platform">
                Platform
                {unreadCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/app/account" className="text-right leading-tight hover:opacity-70" title="Your account">
              <div className="font-medium">{session.fullName}</div>
              <div className="text-xs text-steel">
                {session.isPlatformAdmin ? "Platform operator" : ROLE_LABELS[session.role]}
              </div>
            </Link>
            <form action={logout}>
              <button className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-8 py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-1.5 font-medium text-steel hover:bg-slate-100 hover:text-ink">
      {children}
    </Link>
  );
}
