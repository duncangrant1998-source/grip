import Link from "next/link";
import { Logo } from "@/components/Logo";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/resources", label: "Resources" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact us" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-blueline">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 text-sm text-steel sm:flex-row sm:items-center sm:justify-between">
        <Logo className="h-5" />
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-navy">
              {link.label}
            </Link>
          ))}
        </nav>
        <p>&copy; {new Date().getFullYear()} Grip. Built in Ontario.</p>
      </div>
    </footer>
  );
}
