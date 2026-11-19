import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import {
  CalendarIcon,
  ClipboardIcon,
  PartsIcon,
  ArrowRightIcon,
} from "@/components/icons";

export default async function Home() {
  // Already signed in: skip the pitch, go straight to your shop.
  if (await getSession()) redirect("/app");

  return (
    <main className="min-h-screen overflow-x-clip bg-white font-landing text-navy">
      <SiteHeader />
      <Hero />
      <Problem />
      <FeaturesTeaser />
      <Trust />
      <ContactTeaser />
      <SiteFooter />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-dot-grid text-blueline/70 [mask-image:radial-gradient(ellipse_60%_55%_at_30%_10%,black,transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-10 -z-10 h-[480px] w-[480px] rounded-full bg-shop/20 blur-[110px]"
      />
      <div className="mx-auto grid max-w-5xl gap-14 px-6 pb-20 pt-16 sm:grid-cols-[1.05fr_0.95fr] sm:items-center sm:pb-28 sm:pt-24">
        <div className="fade-up-group max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-shop/30 bg-shop/5 px-3.5 py-1.5 text-sm font-semibold text-shop">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-shop" />
            Coming soon
          </span>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-navy sm:text-6xl">
            Get a Grip
            <br />
            <span className="text-shop">on your business.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-steel">
            Scheduling, work orders, parts, and your whole team, in one place.
            Built specifically for independent automotive repair and
            performance shops.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/contact"
              className="group inline-flex items-center gap-2 rounded-lg bg-shop px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-shop/25 transition hover:-translate-y-0.5 hover:bg-shop/90 hover:shadow-xl hover:shadow-shop/30"
            >
              Get in touch
              <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/features"
              className="rounded-lg border border-blueline px-6 py-3.5 text-sm font-semibold text-navy transition hover:-translate-y-0.5 hover:border-navy hover:shadow-md"
            >
              See what it does
            </Link>
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-navy/5 via-transparent to-shop/10 blur-xl"
          />
          <div className="animate-float rounded-2xl border border-blueline bg-white p-5 shadow-2xl shadow-navy/10">
            <div className="flex items-center justify-between border-b border-blueline/70 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-shop/80" />
                <span className="text-xs font-semibold uppercase tracking-wide text-steel">
                  Redline Performance
                </span>
              </div>
              <span className="text-xs text-steel">Today</span>
            </div>
            <p className="mt-4 text-sm font-semibold text-navy">
              Welcome, Casey 👋
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { value: "11", label: "Open work orders" },
                { value: "1", label: "Appointments today" },
                { value: "2", label: "Parts below reorder" },
                { value: "5", label: "Active staff" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-blueline/70 bg-slate-50 p-3.5"
                >
                  <p className="text-2xl font-bold text-navy">{s.value}</p>
                  <p className="mt-0.5 text-xs text-steel">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-blueline/70 bg-slate-50 p-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-shop/10 text-shop">
                <CalendarIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy">
                  Brake service &mdash; 2018 Civic
                </p>
                <p className="text-xs text-steel">Bay 2 &middot; 10:30 AM</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  const points = [
    {
      title: "Too many places to look",
      body: "A whiteboard for the schedule, a notebook for parts, texts for the team. Nothing lines up, and nothing's written down for next time.",
      icon: ClipboardIcon,
    },
    {
      title: "No record that lasts",
      body: "When a tech leaves or a customer calls back six months later, the history should still be there, not in someone's head.",
      icon: PartsIcon,
    },
    {
      title: "Everyone's guessing",
      body: "Advisors, techs, and parts staff all need the same picture of a job, updated as it happens, not after the fact.",
      icon: CalendarIcon,
    },
  ];

  return (
    <section className="border-t border-blueline">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <h2 className="max-w-lg text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Running a shop shouldn&apos;t mean fighting your own paperwork.
        </h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {points.map((p) => (
            <div
              key={p.title}
              className="group rounded-2xl border border-blueline bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-shop/30 hover:shadow-lg"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy/5 text-navy transition group-hover:bg-shop/10 group-hover:text-shop">
                <p.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-navy">{p.title}</h3>
              <p className="mt-1.5 text-sm text-steel">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesTeaser() {
  const highlights = [
    {
      title: "Scheduling & bays",
      body: "Book appointments against real bay availability and see the day at a glance.",
      icon: CalendarIcon,
    },
    {
      title: "Work orders",
      body: "From quote to invoice, with flat-rate or straight-time labour billing.",
      icon: ClipboardIcon,
    },
    {
      title: "Parts & inventory",
      body: "Stock levels, reorder points, and purchase orders, tied to the jobs that use them.",
      icon: PartsIcon,
    },
  ];

  return (
    <section className="border-t border-blueline bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything in one place.
            </h2>
            <p className="mt-3 max-w-xl text-steel">
              Not a bundle of separate tools bolted together. One system
              where scheduling, parts, and billing already know about each
              other.
            </p>
          </div>
          <Link
            href="/features"
            className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-navy transition hover:text-shop"
          >
            See all features
            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {highlights.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-blueline bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-shop/30 hover:shadow-lg"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-shop/10 text-shop">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-navy">{f.title}</h3>
              <p className="mt-1.5 text-sm text-steel">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const stats = [
    { value: "$0", label: "extra per staff account — one flat price covers everyone" },
    { value: "4", label: "staff roles, each seeing only what's theirs" },
    { value: "0", label: "shops that can see another shop's data" },
  ];

  return (
    <section className="border-t border-blueline">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Built for shops that can&apos;t afford to get this wrong.
        </h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-navy/10 bg-navy p-7 text-white shadow-lg shadow-navy/15"
            >
              <p className="text-5xl font-extrabold text-shop">{s.value}</p>
              <p className="mt-3 text-sm text-white/75">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactTeaser() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-shop via-shop to-orange-700 px-8 py-16 text-center shadow-2xl shadow-shop/25 sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-dot-grid text-white/10 [mask-image:radial-gradient(ellipse_70%_70%_at_50%_0%,black,transparent)]"
        />
        <div className="relative">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Want GRIP running in your shop?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">
            Get in touch and we&apos;ll walk through what it looks like for
            your shop, pricing included.
          </p>
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
  );
}
