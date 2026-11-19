import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CheckCircleIcon, ArrowRightIcon } from "@/components/icons";

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
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-dot-grid text-blueline/70 [mask-image:radial-gradient(ellipse_55%_60%_at_20%_0%,black,transparent)]"
        />
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <h1 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            One price. <span className="text-shop">Everything included.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-steel">
            No per-bay charges, no per-seat charges, no sales call required to
            find out what you&apos;ll pay. One flat price per shop, whether
            you&apos;ve got two bays or ten. We&apos;re finalizing numbers
            ahead of launch — reach out and we&apos;ll let you know as soon
            as pricing is set.
          </p>
        </div>
      </section>

      <section className="border-t border-blueline bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-blueline bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-steel">
                Monthly
              </h2>
              <p className="mt-4 text-4xl font-extrabold text-navy">
                To be announced
              </p>
              <p className="mt-2 text-sm text-steel">
                Billed monthly. Cancel anytime.
              </p>
              <Link
                href="/contact"
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg border border-navy px-6 py-3 text-center text-sm font-semibold text-navy transition hover:bg-navy hover:text-white"
              >
                Get notified
              </Link>
            </div>

            <div className="relative flex flex-col overflow-hidden rounded-2xl border-2 border-shop bg-white p-8 shadow-lg shadow-shop/10 transition hover:-translate-y-1 hover:shadow-xl">
              <span className="absolute right-6 top-6 rounded-full bg-shop/10 px-3 py-1 text-xs font-semibold text-shop">
                Save with annual
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-steel">
                Annual
              </h2>
              <p className="mt-4 text-4xl font-extrabold text-navy">
                To be announced
              </p>
              <p className="mt-2 text-sm text-steel">
                Billed annually. Discounted versus paying monthly.
              </p>
              <Link
                href="/contact"
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-shop px-6 py-3 text-center text-sm font-semibold text-white shadow-md shadow-shop/25 transition hover:-translate-y-0.5 hover:bg-shop/90"
              >
                Get notified
              </Link>
            </div>
          </div>

          <div className="mt-10 rounded-2xl border border-blueline bg-white p-8 shadow-sm">
            <h3 className="font-semibold text-navy">Included on every plan</h3>
            <ul className="mt-5 grid gap-3.5 sm:grid-cols-2">
              {included.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-steel">
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-shop" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-shop via-shop to-orange-700 px-8 py-16 text-center shadow-2xl shadow-shop/25 sm:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-dot-grid text-white/10 [mask-image:radial-gradient(ellipse_70%_70%_at_50%_0%,black,transparent)]"
          />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              GRIP is coming soon. Want to hear when it&apos;s ready?
            </h2>
            <Link
              href="/contact"
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-sm font-semibold text-navy shadow-lg transition hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-xl"
            >
              Contact us
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
