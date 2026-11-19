import Link from "next/link";
import { Logo } from "@/components/Logo";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/resources", label: "Resources" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact us" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-blueline/70 bg-white/80 shadow-[0_1px_0_0_rgba(199,210,224,0.6)] backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="shrink-0 transition hover:opacity-80">
          <Logo className="h-9" />
        </Link>
        <nav className="flex items-center gap-1 text-sm text-steel">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hidden rounded-full px-3.5 py-2 font-medium transition hover:bg-slate-100 hover:text-navy sm:inline"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="ml-2 rounded-full bg-navy px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-navy/90 hover:shadow-md"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
