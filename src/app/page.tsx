import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default async function Home() {
  // Already signed in: skip the pitch, go straight to your shop.
  if (await getSession()) redirect("/app");

  return (
    <main className="min-h-screen bg-white font-landing text-navy">
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
    <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pb-28 sm:pt-28">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-light leading-[1.1] tracking-tight text-navy sm:text-6xl">
          Get a Grip
          <br />
          <span className="font-semibold">on your business.</span>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-steel">
          Scheduling, work orders, parts, and your whole team, in one place.
          Built specifically for independent automotive repair and
          performance shops.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-5">
          <Link
            href="/contact"
            className="rounded-sm bg-shop px-6 py-3 text-sm font-semibold text-white transition hover:bg-shop/90"
          >
            Get in touch
          </Link>
          <Link
            href="/features"
            className="text-sm font-medium text-navy underline decoration-blueline decoration-2 underline-offset-4 transition hover:decoration-shop"
          >
            See what it does
          </Link>
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
      body: "When a tech leaves or a customer calls back six months later, the history should still be there, not in someone's head.",
    },
    {
      title: "Everyone's guessing",
      body: "Advisors, techs, and parts staff all need the same picture of a job, updated as it happens, not after the fact.",
    },
  ];

  return (
    <section className="border-t border-blueline">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="grid gap-10 sm:grid-cols-[1fr_1.4fr] sm:gap-16">
          <h2 className="text-2xl font-light leading-tight tracking-tight sm:text-3xl">
            Running a shop shouldn&apos;t mean fighting your own paperwork.
          </h2>
          <div className="divide-y divide-blueline">
            {points.map((p) => (
              <div key={p.title} className="py-6 first:pt-0 last:pb-0">
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

function FeaturesTeaser() {
  const highlights = [
    {
      title: "Scheduling & bays",
      body: "Book appointments against real bay availability and see the day at a glance.",
    },
    {
      title: "Work orders",
      body: "From quote to invoice, with flat-rate or straight-time labour billing.",
    },
    {
      title: "Parts & inventory",
      body: "Stock levels, reorder points, and purchase orders, tied to the jobs that use them.",
    },
  ];

  return (
    <section className="border-t border-blueline">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <h2 className="text-2xl font-light tracking-tight sm:text-3xl">
          Everything in one place.
        </h2>
        <p className="mt-3 max-w-xl text-steel">
          Not a bundle of separate tools bolted together. One system where
          scheduling, parts, and billing already know about each other.
        </p>
        <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-3">
          {highlights.map((f) => (
            <div key={f.title} className="border-t border-blueline pt-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-steel">{f.body}</p>
            </div>
          ))}
        </div>
        <Link
          href="/features"
          className="mt-10 inline-block text-sm font-medium text-navy underline decoration-blueline decoration-2 underline-offset-4 transition hover:decoration-shop"
        >
          See all features
        </Link>
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
        <h2 className="max-w-md text-2xl font-light leading-tight tracking-tight sm:text-3xl">
          Built for shops that can&apos;t afford to get this wrong.
        </h2>
        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="border-t-2 border-navy pt-4">
              <p className="text-5xl font-light text-navy">{s.value}</p>
              <p className="mt-2 text-sm text-steel">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactTeaser() {
  return (
    <section className="bg-shop">
      <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        <h2 className="text-2xl font-light tracking-tight text-white sm:text-3xl">
          Want GRIP running in your shop?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-white/85">
          Get in touch and we&apos;ll walk through what it looks like for your
          shop, pricing included.
        </p>
        <Link
          href="/contact"
          className="mt-8 inline-block rounded-sm bg-white px-6 py-3 text-sm font-semibold text-navy transition hover:bg-white/90"
        >
          Contact us
        </Link>
      </div>
    </section>
  );
}
