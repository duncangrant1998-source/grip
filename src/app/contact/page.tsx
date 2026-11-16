import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Contact us — Grip" };

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <div className="max-w-xl">
          <h1 className="text-4xl font-light leading-tight tracking-tight sm:text-5xl">
            Want GRIP running in your shop?
          </h1>
          <p className="mt-5 text-lg text-steel">
            Get in touch and we&apos;ll walk through what it looks like for
            your shop, pricing included. We&apos;re a small team, so you'll
            be talking directly with the people building it.
          </p>
          <a
            href="mailto:hello@gripshopos.com"
            className="mt-8 inline-block rounded-sm bg-shop px-6 py-3 text-sm font-semibold text-white transition hover:bg-shop/90"
          >
            hello@gripshopos.com
          </a>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
