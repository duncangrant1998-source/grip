import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Resources — Grip" };

const upcoming = [
  {
    title: "Getting started guide",
    body: "A walkthrough for setting up your shop, staff, and first work order.",
  },
  {
    title: "FAQs",
    body: "Straight answers to the questions shops ask most before switching over.",
  },
  {
    title: "Release notes",
    body: "What's new in Grip, as we ship it.",
  },
];

export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pb-24 sm:pt-28">
        <h1 className="max-w-xl text-4xl font-light leading-tight tracking-tight sm:text-5xl">
          Resources are on the way.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-steel">
          This page is still being built out. Here's what's planned — in the
          meantime, if you have a question, just ask us directly.
        </p>
      </section>
      <section className="border-t border-blueline">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-10 sm:grid-cols-3">
            {upcoming.map((u) => (
              <div key={u.title} className="border-t border-blueline pt-5">
                <h2 className="font-semibold">{u.title}</h2>
                <p className="mt-1.5 text-steel">{u.body}</p>
              </div>
            ))}
          </div>
          <Link
            href="/contact"
            className="mt-12 inline-block text-sm font-medium text-navy underline decoration-blueline decoration-2 underline-offset-4 transition hover:decoration-shop"
          >
            Ask us a question
          </Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
