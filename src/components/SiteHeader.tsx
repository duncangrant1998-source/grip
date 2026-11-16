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
    <header className="sticky top-0 z-10 border-b border-blueline bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/">
          <Logo className="h-6" />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-steel">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hidden hover:text-navy sm:inline"
            >
              {link.label}
            </Link>
          ))}
          <Link href="/login" className="font-medium text-navy hover:text-shop">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
