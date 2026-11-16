import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/Logo";

export default async function Home() {
  // Already signed in: skip the pitch, go straight to your shop.
  if (await getSession()) redirect("/app");

  return (
    <main className="min-h-screen bg-white text-ink">
      <Header />
      <Hero />
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
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Logo className="h-7" />
        <nav className="flex items-center gap-6 text-sm font-medium text-steel">
          <a href="#features" className="hidden hover:text-ink sm:inline">
            Features
          </a>
          <Link
            href="/login"
            className="rounded-md bg-ink px-4 py-2 text-white transition hover:bg-black"
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
    <section className="mx-auto max-w-5xl px-6 pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div className="max-w-2xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-shop">
          Shop management software
        </p>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Get a Grip on your business.
        </h1>
        <p className="mt-5 text-lg text-steel">
          Scheduling, work orders, parts, and your whole team — in one place, built
          specifically for independent automotive repair and performance shops.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#contact"
            className="rounded-md bg-shop px-5 py-3 text-sm font-semibold text-white transition hover:bg-shop/90"
          >
            Get in touch
          </a>
          <a
            href="#features"
            className="rounded-md border border-slate-300 px-5 py-3 text-sm font-semibold text-ink transition hover:border-slate-400"
          >
            See features
          </a>
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
    },
    {
      title: "No record that lasts",
      body: "When a tech leaves or a customer calls back six months later, the history should still be there — not in someone's head.",
    },
    {
      title: "Everyone's guessing",
      body: "Advisors, techs, and parts staff all need the same picture of a job, updated as it happens, not after the fact.",
    },
  ];

  return (
    <section className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <h2 className="text-2xl font-bold sm:text-3xl">
          Running a shop shouldn&apos;t mean fighting your own paperwork.
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {points.map((p) => (
            <div key={p.title}>
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-steel">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      title: "Scheduling & bays",
      body: "Book appointments against real bay availability, assign the right tech, and see the day at a glance.",
    },
    {
      title: "Work orders",
      body: "From quote to invoice, with flat-rate or straight-time labour billing — whichever way your shop charges.",
    },
    {
      title: "Parts & inventory",
      body: "Stock levels, reorder points, suppliers, and purchase orders, tied directly to the jobs that use them.",
    },
    {
      title: "Customers & vehicles",
      body: "Full service history per vehicle, so nobody's starting from scratch on a repeat customer.",
    },
    {
      title: "Staff & time clock",
      body: "Shifts, time-off requests, and time tracked against real jobs — for payroll and billing alike.",
    },
    {
      title: "Reports",
      body: "See what's actually happening in the shop — open work, parts moving slowly, where the hours go.",
    },
  ];

  return (
    <section id="features" className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <h2 className="text-2xl font-bold sm:text-3xl">Everything in one place.</h2>
      <p className="mt-3 max-w-2xl text-steel">
        Not a bundle of separate tools bolted together — one system where
        scheduling, parts, and billing already know about each other.
      </p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-steel">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Trust() {
  const items = [
    {
      title: "Built for Ontario shops",
      body: "HST handled correctly on every invoice, out of the box.",
    },
    {
      title: "Role-based access",
      body: "Service advisors, technicians, parts staff, and shop admins each see what's relevant to them.",
    },
    {
      title: "Your data stays yours",
      body: "Every shop's data is isolated at the database level — no shared views, no cross-shop leaks, even on shared infrastructure.",
    },
  ];

  return (
    <section className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <div className="grid gap-8 sm:grid-cols-3">
          {items.map((i) => (
            <div key={i.title}>
              <h3 className="font-semibold">{i.title}</h3>
              <p className="mt-2 text-sm text-steel">{i.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
        <h2 className="text-2xl font-bold sm:text-3xl">
          Want GRIP running in your shop?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-steel">
          Get in touch and we&apos;ll walk through what it looks like for your shop,
          pricing included.
        </p>
        <a
          href="mailto:hello@gripshopos.com"
          className="mt-6 inline-block rounded-md bg-shop px-5 py-3 text-sm font-semibold text-white transition hover:bg-shop/90"
        >
          hello@gripshopos.com
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-5xl px-6 py-10 text-sm text-steel">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <Logo className="h-5" />
        <p>&copy; {new Date().getFullYear()} Grip. Built in Ontario.</p>
      </div>
    </footer>
  );
}
