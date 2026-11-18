"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type AppNavLink = {
  href: string;
  label: string;
  badge?: number;
};

export function AppNav({
  logo,
  shopName,
  links,
  fullName,
  roleLabel,
  logoutAction,
}: {
  // Rendered server-side and passed down: Logo reads the filesystem to check
  // for a logo image, so it can't be imported into this client component.
  logo: React.ReactNode;
  shopName: string | undefined;
  links: AppNavLink[];
  fullName: string;
  roleLabel: string;
  logoutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu on navigation.
  const close = () => setOpen(false);

  return (
    <>
      <div className="mx-auto flex max-w-[1800px] items-center gap-4 px-4 py-3 sm:gap-6 sm:px-8">
        <Link href="/app" className="shrink-0" aria-label="Grip — dashboard" onClick={close}>
          {logo}
        </Link>
        <div className="hidden truncate text-sm font-semibold sm:block">{shopName}</div>

        <nav className="ml-4 hidden flex-wrap gap-1 text-sm lg:flex">
          {links.map((link) => (
            <NavLink key={link.href} href={link.href} active={pathname === link.href}>
              {link.label}
              {!!link.badge && (
                <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {link.badge > 99 ? "99+" : link.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 text-sm lg:flex">
          <Link href="/app/account" className="text-right leading-tight hover:opacity-70" title="Your account">
            <div className="font-medium">{fullName}</div>
            <div className="text-xs text-steel">{roleLabel}</div>
          </Link>
          <form action={logoutAction}>
            <button className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
              Sign out
            </button>
          </form>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 lg:hidden"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 lg:hidden">
          {shopName && <div className="mb-2 px-1 text-sm font-semibold">{shopName}</div>}
          <nav className="flex flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={close}
                className={`flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium ${
                  pathname === link.href ? "bg-slate-100 text-ink" : "text-steel hover:bg-slate-50 hover:text-ink"
                }`}
              >
                <span>{link.label}</span>
                {!!link.badge && (
                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {link.badge > 99 ? "99+" : link.badge}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
            <Link href="/app/account" onClick={close} className="leading-tight hover:opacity-70" title="Your account">
              <div className="text-sm font-medium">{fullName}</div>
              <div className="text-xs text-steel">{roleLabel}</div>
            </Link>
            <form action={logoutAction}>
              <button className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex items-center rounded-md px-3 py-1.5 font-medium ${
        active ? "bg-slate-100 text-ink" : "text-steel hover:bg-slate-100 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
