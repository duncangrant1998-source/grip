/**
 * Role-based permissions — the application layer.
 *
 * This is deliberately separate from the tenant boundary. Which *shop* you can
 * see is enforced by Postgres row-level security and cannot be forgotten here.
 * What you can *do* inside your shop is this file, and the matrix in
 * docs/DESIGN.md §5 is its source of truth.
 */

export type Role = "service_advisor" | "technician" | "parts_advisor" | "shop_admin";

export type Department = "service" | "parts" | "admin";

export type Action =
  | "appointments.view"
  | "appointments.edit"
  | "customers.view"
  | "customers.edit"
  | "workorders.create"
  | "workorders.view"
  | "workorders.addLabour"
  | "workorders.addPart"
  | "workorders.changeStatus"
  | "workorders.invoice"
  | "parts.viewCost"
  | "inventory.view"
  | "inventory.edit"
  | "purchaseOrders.manage"
  | "counterSales.create"
  | "staff.manage"
  | "reports.margin"
  | "reports.partsOnly"
  | "settings.manage"
  | "shortcuts.manage"
  | "timeclock.own";

const ALL: Action[] = [
  "appointments.view", "appointments.edit",
  "customers.view", "customers.edit",
  "workorders.create", "workorders.view", "workorders.addLabour", "workorders.addPart",
  "workorders.changeStatus", "workorders.invoice",
  "parts.viewCost", "inventory.view", "inventory.edit", "purchaseOrders.manage",
  "counterSales.create",
  "staff.manage", "reports.margin", "reports.partsOnly", "settings.manage", "shortcuts.manage",
  "timeclock.own",
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  shop_admin: new Set(ALL),

  service_advisor: new Set<Action>([
    "appointments.view", "appointments.edit",
    "customers.view", "customers.edit",
    "workorders.create", "workorders.view", "workorders.addLabour", "workorders.addPart",
    "workorders.changeStatus", "workorders.invoice",
    "inventory.view", "shortcuts.manage",
    "timeclock.own",
  ]),

  // Technicians get a deliberately narrow view: their own jobs and hours.
  technician: new Set<Action>([
    "appointments.view",       // own only — narrowed at query time
    "workorders.view",         // own only
    "workorders.addLabour",    // own only
    "workorders.changeStatus", // to in_progress / completed only
    "timeclock.own",
  ]),

  // The parts counter opens work orders and serves walk-ins, so it needs to
  // find and add customers even though it lives outside the service department.
  parts_advisor: new Set<Action>([
    "customers.view", "customers.edit",
    "workorders.create", "workorders.view", "workorders.addPart",
    "parts.viewCost", "inventory.view", "inventory.edit",
    "purchaseOrders.manage", "counterSales.create",
    "reports.partsOnly", "shortcuts.manage",
    "timeclock.own",
  ]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}

export type WorkOrderStatus =
  | "quote" | "approved" | "in_progress" | "completed" | "invoiced" | "paid" | "cancelled";

/**
 * Who may move a work order into a given status. The database separately
 * decides which moves are *legal* (e.g. you cannot invoice a quote); this
 * decides who is allowed to press the button.
 *
 * Technicians run the job — start it, finish it — but approving, invoicing,
 * taking payment and cancelling stay at the service desk. The parts desk
 * contributes lines to the order but does not steer its lifecycle.
 */
export function canTransition(role: Role, to: WorkOrderStatus): boolean {
  if (!can(role, "workorders.changeStatus")) return false;
  if (role === "technician") return to === "in_progress" || to === "completed";
  if (to === "invoiced") return can(role, "workorders.invoice");
  return true;
}

const DEPARTMENTS: Record<Role, readonly Department[]> = {
  shop_admin: ["service", "parts", "admin"],
  service_advisor: ["service"],
  technician: ["service"],
  parts_advisor: ["parts"],
};

export function departmentsFor(role: Role): readonly Department[] {
  return DEPARTMENTS[role];
}

export function canAccessDepartment(role: Role, dept: Department): boolean {
  return DEPARTMENTS[role].includes(dept);
}

/** Where a user lands after login. */
export function homeFor(role: Role): string {
  return "/app";
}

export const ROLE_LABELS: Record<Role, string> = {
  shop_admin: "Shop administrator",
  service_advisor: "Service advisor",
  technician: "Technician",
  parts_advisor: "Parts advisor",
};
