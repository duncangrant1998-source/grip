import { EXEMPT_REASON_LABELS, STATUS_LABELS } from "@/lib/format";

type Diff = Record<string, unknown> | null;

const str = (v: unknown) => (v == null ? "" : String(v));

/** Turns an audit_log row into a sentence for the activity feed. */
export function describeAudit(action: string, diff: Diff): string {
  const d = diff ?? {};
  switch (action) {
    case "work_order.created":
      return "opened this work order";
    case "labour.added":
      return `added labour: ${str(d.description)} (${Number(d.hours).toFixed(2)} h)`;
    case "labour.edited":
      return `edited labour: ${str(d.description)}`;
    case "part.tax_changed":
      return `${d.taxable ? "turned tax on for" : "turned tax off for"} ${str(d.description)}`;
    case "work_order.notes_edited":
      return "edited the notes";
    case "work_order.customer_changed":
      return `moved the order to ${str(d.customer)}`;
    case "labour.removed":
      return `removed labour: ${str(d.description)}`;
    case "part.added": {
      const qty = Number(d.qty);
      const bo = Number(d.backordered ?? 0);
      return `added ${qty} × ${str(d.description)}${bo > 0 ? ` (${bo} backordered)` : ""}`;
    }
    case "part.backorder_filled":
      return `received stock and allocated ${Number(d.qty)} × ${str(d.description)} to this order`;
    case "part.removed":
      return `removed ${Number(d.qty)} × ${str(d.description)}`;
    case "shortcut.applied": {
      const bits = [
        Number(d.labour) > 0 && `${Number(d.labour)} labour line${Number(d.labour) > 1 ? "s" : ""}`,
        Number(d.parts) > 0 && `${Number(d.parts)} part${Number(d.parts) > 1 ? "s" : ""}`,
      ].filter(Boolean).join(" and ");
      const bo = Number(d.backordered ?? 0);
      return `used shortcut ${str(d.code)} (${str(d.name)}): ${bits}${bo > 0 ? `, ${bo} backordered` : ""}`;
    }
    case "work_order.exemption_set":
      return d.reason
        ? `recorded why this order is exempt: ${EXEMPT_REASON_LABELS[str(d.reason)] ?? str(d.reason)}${d.reference ? ` (${str(d.reference)})` : ""}`
        : "cleared the exemption reason";
    case "work_order.tax_changed":
      return d.name ? `set tax to ${str(d.name)}` : "removed tax";
    case "work_order.labour_mode_changed":
      return `changed labour billing to ${str(d.to).replace("_", " ")}`;
    default:
      if (action.startsWith("work_order.")) {
        const to = action.slice("work_order.".length);
        return `moved the order to ${(STATUS_LABELS[to] ?? to).toLowerCase()}`;
      }
      return action;
  }
}
