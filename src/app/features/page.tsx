import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import {
  CalendarIcon,
  ClipboardIcon,
  PartsIcon,
  VehicleIcon,
  UsersIcon,
  ChartIcon,
  TagIcon,
  ShieldIcon,
} from "@/components/icons";

export const metadata = { title: "Features — Grip" };

const features = [
  {
    title: "Scheduling & bays",
    body: "Book appointments against real bay availability, assign the right tech, and see the day at a glance. No double-booking a bay that's already full.",
    icon: CalendarIcon,
  },
  {
    title: "Work orders",
    body: "From quote to invoice, with flat-rate or straight-time labour billing, whichever way your shop charges. Save common jobs as shortcuts so a routine service doesn't mean rebuilding the same work order from scratch every time.",
    icon: ClipboardIcon,
  },
  {
    title: "Parts & inventory",
    body: "Stock levels, reorder points, suppliers, and purchase orders, tied directly to the jobs that use them, so a part on a work order is a part you know you have.",
    icon: PartsIcon,
  },
  {
    title: "Customers & vehicles",
    body: "Full service history per vehicle, so nobody's starting from scratch on a repeat customer. VIN decoding fills in year, make, and model automatically.",
    icon: VehicleIcon,
  },
  {
    title: "Staff & time clock",
    body: "Shifts, time-off requests, and time tracked against real jobs, for payroll and billing alike. Admins see timesheets and schedules in one place.",
    icon: UsersIcon,
  },
  {
    title: "Reports",
    body: "See what's actually happening in the shop: open work, parts moving slowly, where the hours go, broken down by tech or by job.",
    icon: ChartIcon,
  },
  {
    title: "One flat price",
    body: "No per-bay or per-seat charges. Add staff as you grow and your bill doesn't move — the more your team uses Grip, the cheaper it gets per person.",
    icon: TagIcon,
  },
  {
    title: "Role-based access",
    body: "Service advisors, technicians, parts staff, and shop admins each see what's relevant to them, nothing more.",
    icon: ShieldIcon,
  },
];

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-white font-landing text-navy">
      <SiteHeader />
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-dot-grid text-blueline/70 [mask-image:radial-gradient(ellipse_55%_60%_at_20%_0%,black,transparent)]"
        />
        <div className="mx-auto max-w-5xl px-6 pb-20 pt-20 sm:pb-24 sm:pt-28">
          <h1 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Everything in <span className="text-shop">one place.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-steel">
            Not a bundle of separate tools bolted together. One system where
            scheduling, parts, and billing already know about each other.
          </p>
        </div>
      </section>
      <section className="border-t border-blueline bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <div className="grid gap-5 sm:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.title}
                className="group flex gap-4 rounded-2xl border border-blueline bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-shop/30 hover:shadow-lg"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-shop/10 text-shop">
                  <f.icon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-semibold text-navy">{f.title}</h2>
                  <p className="mt-1.5 text-sm text-steel">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
