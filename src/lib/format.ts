const currency = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export function money(value: string | number | null | undefined): string {
  return currency.format(Number(value ?? 0));
}

export function hours(value: string | number | null | undefined): string {
  return Number(value ?? 0).toFixed(2);
}

export function dateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-CA", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function date(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
  });
}

/**
 * For Postgres `date` columns (no time, no zone). The driver hands them back as
 * UTC midnight, so they must be formatted in UTC — formatting in local time
 * shows the previous day anywhere west of Greenwich.
 */
export function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export const STATUS_LABELS: Record<string, string> = {
  quote: "Quote",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const EDITABLE_STATUSES = ["quote", "approved", "in_progress"] as const;

export function isEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** Labour stays editable until the order is invoiced; parts stop at "completed". */
export function isLabourEditable(status: string): boolean {
  return ["quote", "approved", "in_progress", "completed"].includes(status);
}

/** Customer, vehicle and concern can change until the order is issued. */
export function isDetailsEditable(status: string): boolean {
  return !["invoiced", "paid", "cancelled"].includes(status);
}

export const MODE_LABELS: Record<string, string> = {
  flat_rate: "Flat rate (book time)",
  straight_time: "Straight time (actual hours)",
};

/** Why a document carries no HST. Kept short — these print on invoices. */
export const EXEMPT_REASON_LABELS: Record<string, string> = {
  status_card: "Status card",
  government: "Government or diplomatic",
  resale: "Purchased for resale",
  export: "Delivered outside the province",
  internal: "Shop's own vehicle",
  other: "Other",
};

/** What the number beside each reason is called, where there is one. */
export const EXEMPT_REFERENCE_LABELS: Record<string, string> = {
  status_card: "Status card number",
  government: "Government account number",
  resale: "Purchaser's HST number",
  export: "Reference (optional)",
  internal: "Reference (optional)",
  other: "Reference (optional)",
};

/** Kinds the shop must record a number for — mirrors the database rule. */
export function exemptNeedsReference(reason: string): boolean {
  return ["status_card", "government", "resale"].includes(reason);
}
