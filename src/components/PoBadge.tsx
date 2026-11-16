const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  ordered: "bg-blue-50 text-blue-700",
  partial: "bg-amber-50 text-amber-800",
  received: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
  open: "bg-amber-50 text-amber-800",
  completed: "bg-emerald-50 text-emerald-700",
};

/** Status pill shared by purchase orders and counter sales. */
export function PoBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[status] ?? "bg-slate-100"}`}>
      {status}
    </span>
  );
}
