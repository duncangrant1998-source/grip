type Diff = Record<string, unknown> | null;
const str = (v: unknown) => (v == null ? "" : String(v));

/** Activity-feed text for purchase orders and counter sales. */
export function describePartsAudit(action: string, diff: Diff): string {
  const d = diff ?? {};
  switch (action) {
    case "purchase_order.created": return "created this purchase order";
    case "purchase_order.placed": return "placed the order with the supplier";
    case "purchase_order.received":
      return `received ${Number(d.qty)} × ${str(d.sku)}` +
        (Number(d.allocated_to_jobs) > 0 ? ` — ${Number(d.allocated_to_jobs)} went straight to waiting jobs` : "");
    case "purchase_order.cancelled": return "cancelled the order";
    case "purchase_order.closed_short": return "closed the order short";
    case "counter_sale.created": return "started this sale";
    case "counter_sale.completed": return "completed the sale";
    case "counter_sale.cancelled": return "cancelled the sale and returned the parts";
    case "part.sold": return `sold ${Number(d.qty)} × ${str(d.description)}`;
    case "part.unsold": return `removed ${Number(d.qty)} × ${str(d.description)} and returned it to stock`;
    default: return action;
  }
}
