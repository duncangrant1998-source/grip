import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ClipboardIcon, TagIcon, ChartIcon, ArrowRightIcon } from "@/components/icons";

export const metadata = { title: "Resources — Grip" };

const upcoming = [
  {
    title: "Getting started guide",
    body: "A walkthrough for setting up your shop, staff, and first work order.",
    icon: ClipboardIcon,
  },
  {
    title: "FAQs",
    body: "Straight answers to the questions shops ask most before switching over.",
    icon: TagIcon,
  },
  {
    title: "Release notes",
    body: "What's new in Grip, as we ship it.",
    icon: ChartIcon,
  },
];

export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[380px] bg-dot-grid text-blueline/70 [mask-image:radial-gradient(ellipse_55%_60%_at_20%_0%,black,transparent)]"
        />
        <div className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pb-24 sm:pt-28">
          <h1 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Resources are <span className="text-shop">on the way.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-steel">
            This page is still being built out. Here&apos;s what&apos;s
            planned — in the meantime, if you have a question, just ask us
            directly.
          </p>
        </div>
      </section>
      <section className="border-t border-blueline bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-5 sm:grid-cols-3">
            {upcoming.map((u) => (
              <div
                key={u.title}
                className="group rounded-2xl border border-blueline bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-shop/30 hover:shadow-lg"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-shop/10 text-shop">
                  <u.icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 font-semibold text-navy">{u.title}</h2>
                <p className="mt-1.5 text-sm text-steel">{u.body}</p>
              </div>
            ))}
          </div>
          <Link
            href="/contact"
            className="group mt-12 inline-flex items-center gap-1.5 text-sm font-semibold text-navy transition hover:text-shop"
          >
            Ask us a question
            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
