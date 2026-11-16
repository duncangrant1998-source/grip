import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Pricing — Grip" };

const factors = [
  {
    title: "Shop size",
    body: "How many bays and how many staff accounts you need — a two-bay shop and a ten-bay shop don't pay the same.",
  },
  {
    title: "Which modules you use",
    body: "Every shop uses scheduling and work orders. Not every shop needs the full staff time-clock or multi-location reporting.",
  },
  {
    title: "How you're billing today",
    body: "Switching from a whiteboard and a spreadsheet is a different conversation than switching off another shop management system.",
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pb-24 sm:pt-28">
        <h1 className="max-w-xl text-4xl font-light leading-tight tracking-tight sm:text-5xl">
          Pricing built around your shop, not a seat count.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-steel">
          We're not quite ready to put a price list on this page — we'd
          rather understand your shop first and give you a number that
          actually fits it. Here's what goes into that conversation.
        </p>
      </section>
      <section className="border-t border-blueline">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-10 sm:grid-cols-3">
            {factors.map((f) => (
              <div key={f.title} className="border-t-2 border-navy pt-4">
                <h2 className="font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-steel">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-shop">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
          <h2 className="text-2xl font-light tracking-tight text-white sm:text-3xl">
            Get in touch and we&apos;ll walk through a number for your shop.
          </h2>
          <Link
            href="/contact"
            className="mt-8 inline-block rounded-sm bg-white px-6 py-3 text-sm font-semibold text-navy transition hover:bg-white/90"
          >
            Contact us
          </Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
