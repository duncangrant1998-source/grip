// Shared Tailwind class strings, so forms and buttons look the same everywhere.

export const input =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-shop focus:ring-2 focus:ring-shop/20 disabled:opacity-60";

export const btn =
  "rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60";

export const btnGhost =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-60";

export const btnDanger =
  "rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";

export const card = "rounded-xl border border-slate-200 bg-white shadow-sm";

export const label = "mb-1 block text-xs font-medium text-steel";

export const STATUS_STYLES: Record<string, string> = {
  quote: "bg-slate-100 text-slate-700",
  approved: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-800",
  completed: "bg-violet-50 text-violet-700",
  invoiced: "bg-emerald-50 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-50 text-red-700",
};
