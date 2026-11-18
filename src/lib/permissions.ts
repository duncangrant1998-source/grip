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

// A shop admin can give a staff member one or more *extra* roles on top of
// their own, from the Staff tab's role picker — e.g. a technician who is also
// ticked for parts advisor gets everything a parts advisor can do, in
// addition to whatever being a technician already gives them. It is purely
// additive: ticking a role never takes anything away, and unticking one only
// removes what that specific role alone granted (something another checked
// role still grants stays granted).
export function can(role: Role, action: Action, extraRoles: readonly Role[] = []): boolean {
  if (MATRIX[role].has(action)) return true;
  return extraRoles.some((r) => MATRIX[r].has(action));
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
export function canTransition(
  role: Role,
  to: WorkOrderStatus,
  extraRoles: readonly Role[] = [],
): boolean {
  if (!can(role, "workorders.changeStatus", extraRoles)) return false;
  // Narrow (own-job-only) movement applies only if every role in play that
  // grants workorders.changeStatus at all is the technician role itself —
  // being also ticked for service advisor or shop admin lifts the limit.
  const grantors = [role, ...extraRoles].filter((r) => MATRIX[r].has("workorders.changeStatus"));
  if (grantors.every((r) => r === "technician")) {
    return to === "in_progress" || to === "completed";
  }
  if (to === "invoiced") return can(role, "workorders.invoice", extraRoles);
  return true;
}

const DEPARTMENTS: Record<Role, readonly Department[]> = {
  shop_admin: ["service", "parts", "admin"],
  service_advisor: ["service"],
  technician: ["service"],
  parts_advisor: ["parts"],
};

export function departmentsFor(role: Role, extraRoles: readonly Role[] = []): Department[] {
  return Array.from(new Set([role, ...extraRoles].flatMap((r) => DEPARTMENTS[r])));
}

export function canAccessDepartment(
  role: Role,
  dept: Department,
  extraRoles: readonly Role[] = [],
): boolean {
  return DEPARTMENTS[role].includes(dept) || extraRoles.some((r) => DEPARTMENTS[r].includes(dept));
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

/** Display order for the role picker, and the precedence used by splitRoles. */
export const ALL_ROLES: Role[] = ["shop_admin", "service_advisor", "parts_advisor", "technician"];

/**
 * The database stores one "primary" role per login (for things like the
 * technician billing flag and the Role column) plus a set of extra roles on
 * top. The role picker just shows a flat set of ticked boxes, so this picks
 * which ticked role is primary — by precedence, admin first — and returns the
 * rest as extras. Purely a storage/display detail: `can()` treats the primary
 * role and every extra role identically.
 */
export function splitRoles(roles: readonly Role[]): { role: Role; extraRoles: Role[] } {
  const set = new Set(roles);
  const role = ALL_ROLES.find((r) => set.has(r)) ?? "service_advisor";
  set.delete(role);
  return { role, extraRoles: Array.from(set) };
}
