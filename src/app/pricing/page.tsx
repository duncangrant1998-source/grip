import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Pricing — Grip" };

const included = [
  "Unlimited staff accounts",
  "Every feature included — scheduling, work orders, parts, reports",
  "No setup fees or hidden costs",
  "No per-bay or per-seat charges",
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
        <h1 className="max-w-xl text-4xl font-light leading-tight tracking-tight sm:text-5xl">
          One price. Everything included.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-steel">
          No per-bay charges, no per-seat charges, no sales call required to
          find out what you&apos;ll pay. One flat price per shop, whether
          you&apos;ve got two bays or ten. We&apos;re finalizing numbers
          ahead of launch — reach out and we&apos;ll let you know as soon
          as pricing is set.
        </p>
      </section>

      <section className="border-t border-blueline">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-8 sm:grid-cols-2">
            <div className="flex flex-col border border-blueline p-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-steel">
                Monthly
              </h2>
              <p className="mt-4 text-4xl font-light text-navy">
                To be announced
              </p>
              <p className="mt-2 text-sm text-steel">Billed monthly. Cancel anytime.</p>
              <Link
                href="/contact"
                className="mt-8 inline-block rounded-sm border border-navy px-6 py-3 text-center text-sm font-semibold text-navy transition hover:bg-navy hover:text-white"
              >
                Get notified
              </Link>
            </div>

            <div className="flex flex-col border-2 border-navy p-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-steel">
                Annual
              </h2>
              <p className="mt-4 text-4xl font-light text-navy">
                To be announced
              </p>
              <p className="mt-2 text-sm text-steel">
                Billed annually. Discounted versus paying monthly.
              </p>
              <Link
                href="/contact"
                className="mt-8 inline-block rounded-sm bg-shop px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-shop/90"
              >
                Get notified
              </Link>
            </div>
          </div>

          <div className="mt-12 border-t border-blueline pt-8">
            <h3 className="font-semibold">Included on every plan</h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {included.map((item) => (
                <li key={item} className="flex gap-2 text-steel">
                  <span className="text-shop">—</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-shop">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
          <h2 className="text-2xl font-light tracking-tight text-white sm:text-3xl">
            GRIP is coming soon. Want to hear when it&apos;s ready?
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
