import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ArrowRightIcon } from "@/components/icons";

export const metadata = { title: "Contact us — Grip" };

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-dot-grid text-blueline/70 [mask-image:radial-gradient(ellipse_60%_65%_at_25%_0%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 top-0 -z-10 h-[420px] w-[420px] rounded-full bg-shop/15 blur-[100px]"
        />
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="max-w-xl rounded-2xl border border-blueline bg-white p-8 shadow-xl shadow-navy/5 sm:p-10">
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Want GRIP running in your shop?
            </h1>
            <p className="mt-5 text-lg text-steel">
              Get in touch and we&apos;ll walk through what it looks like for
              your shop, pricing included. We&apos;re a small team, so
              you&apos;ll be talking directly with the people building it.
            </p>
            <a
              href="mailto:admin@gripshopos.com"
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-shop px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-shop/25 transition hover:-translate-y-0.5 hover:bg-shop/90 hover:shadow-xl"
            >
              admin@gripshopos.com
              <ArrowRightIcon className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
