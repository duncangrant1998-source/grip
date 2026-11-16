import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Features — Grip" };

const features = [
  {
    title: "Scheduling & bays",
    body: "Book appointments against real bay availability, assign the right tech, and see the day at a glance. No double-booking a bay that's already full.",
  },
  {
    title: "Work orders",
    body: "From quote to invoice, with flat-rate or straight-time labour billing, whichever way your shop charges. Save common jobs as shortcuts so a routine service doesn't mean rebuilding the same work order from scratch every time.",
  },
  {
    title: "Parts & inventory",
    body: "Stock levels, reorder points, suppliers, and purchase orders, tied directly to the jobs that use them, so a part on a work order is a part you know you have.",
  },
  {
    title: "Customers & vehicles",
    body: "Full service history per vehicle, so nobody's starting from scratch on a repeat customer. VIN decoding fills in year, make, and model automatically.",
  },
  {
    title: "Staff & time clock",
    body: "Shifts, time-off requests, and time tracked against real jobs, for payroll and billing alike. Admins see timesheets and schedules in one place.",
  },
  {
    title: "Reports",
    body: "See what's actually happening in the shop: open work, parts moving slowly, where the hours go, broken down by tech or by job.",
  },
  {
    title: "Built for Ontario shops",
    body: "HST is calculated correctly on every invoice, out of the box, including exemptions. Billing that already understands Canadian tax rules, not retrofitted for them.",
  },
  {
    title: "Role-based access",
    body: "Service advisors, technicians, parts staff, and shop admins each see what's relevant to them, nothing more.",
  },
];

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pb-24 sm:pt-28">
        <h1 className="max-w-xl text-4xl font-light leading-tight tracking-tight sm:text-5xl">
          Everything in one place.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-steel">
          Not a bundle of separate tools bolted together. One system where
          scheduling, parts, and billing already know about each other.
        </p>
      </section>
      <section className="border-t border-blueline">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.title} className="border-t border-blueline pt-5">
                <h2 className="font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-steel">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
