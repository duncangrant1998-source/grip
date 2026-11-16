import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/Logo";

export default async function Home() {
  // Already signed in: skip the pitch, go straight to your shop.
  if (await getSession()) redirect("/app");

  return (
    <main className="min-h-screen bg-paper font-body text-ink">
      <Header />
      <Hero />
      <HazardStripe />
      <Problem />
      <Features />
      <Trust />
      <Contact />
      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Logo className="h-7" />
        <nav className="flex items-center gap-6 text-sm font-medium text-steel">
          <a href="#features" className="hidden hover:text-ink sm:inline">
            Features
          </a>
          <Link
            href="/login"
            className="rounded bg-ink px-4 py-2 font-semibold text-white transition hover:bg-black"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-ink text-white">
      {/* Faint tread-groove texture — diagonal lines, like tire tread or a shop floor. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, #fff 0px, #fff 2px, transparent 2px, transparent 26px)",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-16 sm:pb-32 sm:pt-20">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight text-white sm:text-7xl">
            Get a Grip
            <br />
            on your business.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-white/70">
            Scheduling, work orders, parts, and your whole team, in one place.
            Built specifically for independent automotive repair and
            performance shops.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href="#contact"
              className="rounded bg-shop px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-shop/90"
            >
              Get in touch
            </a>
            <a
              href="#features"
              className="rounded border border-white/25 px-6 py-3.5 text-sm font-semibold text-white transition hover:border-white/50"
            >
              See what it does
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A caution-stripe band, the one place this page spends its boldness. */
function HazardStripe() {
  return (
    <div
      aria-hidden
      className="h-4 w-full sm:h-5"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, #12151a 0 22px, #f2b705 22px 44px)",
      }}
    />
  );
}

function Problem() {
  const points = [
    {
      title: "Too many places to look",
      body: "A whiteboard for the schedule, a notebook for parts, texts for the team. Nothing lines up, and nothing's written down for next time.",
    },
    {
      title: "No record that lasts",
      body: "When a tech leaves or a customer calls back six months later, the history should still be there, not in someone's head.",
    },
    {
      title: "Everyone's guessing",
      body: "Advisors, techs, and parts staff all need the same picture of a job, updated as it happens, not after the fact.",
    },
  ];

  return (
    <section className="bg-paper">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <div className="grid gap-10 sm:grid-cols-[1fr_1.4fr] sm:gap-16">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Running a shop shouldn&apos;t mean fighting your own paperwork.
          </h2>
          <div className="space-y-7">
            {points.map((p) => (
              <div key={p.title} className="border-l-2 border-shop/70 pl-5">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-steel">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      ticket: "WO-042",
      title: "Scheduling & bays",
      body: "Book appointments against real bay availability, assign the right tech, and see the day at a glance.",
    },
    {
      ticket: "WO-087",
      title: "Work orders",
      body: "From quote to invoice, with flat-rate or straight-time labour billing, whichever way your shop charges.",
    },
    {
      ticket: "WO-156",
      title: "Parts & inventory",
      body: "Stock levels, reorder points, suppliers, and purchase orders, tied directly to the jobs that use them.",
    },
    {
      ticket: "WO-203",
      title: "Customers & vehicles",
      body: "Full service history per vehicle, so nobody's starting from scratch on a repeat customer.",
    },
    {
      ticket: "WO-061",
      title: "Staff & time clock",
      body: "Shifts, time-off requests, and time tracked against real jobs, for payroll and billing alike.",
    },
    {
      ticket: "WO-129",
      title: "Reports",
      body: "See what's actually happening in the shop: open work, parts moving slowly, where the hours go.",
    },
  ];

  return (
    <section id="features" className="border-t border-ink/10 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Everything in one place.
        </h2>
        <p className="mt-3 max-w-xl text-steel">
          Not a bundle of separate tools bolted together. One system where
          scheduling, parts, and billing already know about each other.
        </p>
        <div className="mt-12 divide-y divide-ink/10 border-y border-ink/10">
          {features.map((f) => (
            <div key={f.ticket} className="flex flex-col gap-1 py-5 sm:flex-row sm:items-baseline sm:gap-8">
              <span className="font-mono text-xs text-shop/80 sm:w-20 sm:shrink-0">
                {f.ticket}
              </span>
              <div className="sm:flex sm:flex-1 sm:items-baseline sm:gap-8">
                <h3 className="font-semibold sm:w-56 sm:shrink-0">{f.title}</h3>
                <p className="text-steel">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  const gauges = [
    { value: "13%", label: "Ontario HST, calculated automatically on every invoice" },
    { value: "4", label: "staff roles, each seeing only what's theirs" },
    { value: "Zero", label: "shops that can see another shop's data" },
  ];

  return (
    <section className="bg-ink text-white">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-white/90 sm:text-3xl">
          Built for shops that can&apos;t afford to get this wrong.
        </h2>
        <div className="mt-12 grid gap-10 sm:grid-cols-3 sm:divide-x sm:divide-white/15">
          {gauges.map((g) => (
            <div key={g.label} className="sm:pl-10 sm:first:pl-0">
              <p className="font-display text-5xl font-bold text-caution sm:text-6xl">
                {g.value}
              </p>
              <p className="mt-3 text-sm text-white/65">{g.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="bg-shop text-white">
      <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Want GRIP running in your shop?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-white/85">
          Get in touch and we&apos;ll walk through what it looks like for your
          shop, pricing included.
        </p>
        <a
          href="mailto:hello@gripshopos.com"
          className="mt-8 inline-block rounded bg-ink px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-black"
        >
          hello@gripshopos.com
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-white/50 sm:flex-row">
        <Logo className="h-5 brightness-0 invert" />
        <p>&copy; {new Date().getFullYear()} Grip. Built in Ontario.</p>
      </div>
    </footer>
  );
}
