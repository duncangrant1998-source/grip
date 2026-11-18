import { describe, expect, test } from "vitest";
import { can, canAccessDepartment, departmentsFor, splitRoles } from "../src/lib/permissions";

describe("the shared work order: both desks can add to it", () => {
  test("service advisor adds labour and parts", () => {
    expect(can("service_advisor", "workorders.addLabour")).toBe(true);
    expect(can("service_advisor", "workorders.addPart")).toBe(true);
  });

  test("parts advisor adds parts but not labour", () => {
    expect(can("parts_advisor", "workorders.addPart")).toBe(true);
    expect(can("parts_advisor", "workorders.addLabour")).toBe(false);
  });
});

describe("part cost is hidden from the service desk", () => {
  test("service cannot see cost, parts and admin can", () => {
    expect(can("service_advisor", "parts.viewCost")).toBe(false);
    expect(can("technician", "parts.viewCost")).toBe(false);
    expect(can("parts_advisor", "parts.viewCost")).toBe(true);
    expect(can("shop_admin", "parts.viewCost")).toBe(true);
  });
});

describe("administration is admin-only", () => {
  test.each(["staff.manage", "settings.manage", "reports.margin"] as const)("%s", (action) => {
    expect(can("shop_admin", action)).toBe(true);
    expect(can("service_advisor", action)).toBe(false);
    expect(can("parts_advisor", action)).toBe(false);
    expect(can("technician", action)).toBe(false);
  });
});

describe("departments", () => {
  test("admin reaches all three", () => {
    expect(departmentsFor("shop_admin")).toEqual(["service", "parts", "admin"]);
  });

  test("each department login is scoped to its own area", () => {
    expect(canAccessDepartment("service_advisor", "service")).toBe(true);
    expect(canAccessDepartment("service_advisor", "parts")).toBe(false);
    expect(canAccessDepartment("parts_advisor", "parts")).toBe(true);
    expect(canAccessDepartment("parts_advisor", "service")).toBe(false);
    expect(canAccessDepartment("technician", "admin")).toBe(false);
  });
});

describe("technicians", () => {
  test("cannot create appointments, invoice, or touch inventory", () => {
    expect(can("technician", "appointments.edit")).toBe(false);
    expect(can("technician", "workorders.invoice")).toBe(false);
    expect(can("technician", "inventory.edit")).toBe(false);
  });
});

describe("who can steer a work order's lifecycle", () => {
  test("service desk and admin can take an order through every status", async () => {
    const { canTransition } = await import("../src/lib/permissions");
    for (const to of ["approved", "in_progress", "completed", "invoiced", "paid", "cancelled"] as const) {
      expect(canTransition("service_advisor", to)).toBe(true);
      expect(canTransition("shop_admin", to)).toBe(true);
    }
  });

  test("technicians can start and finish a job, nothing else", async () => {
    const { canTransition } = await import("../src/lib/permissions");
    expect(canTransition("technician", "in_progress")).toBe(true);
    expect(canTransition("technician", "completed")).toBe(true);
    for (const to of ["approved", "invoiced", "paid", "cancelled"] as const) {
      expect(canTransition("technician", to)).toBe(false);
    }
  });

  test("the parts desk adds lines but never moves the order", async () => {
    const { canTransition } = await import("../src/lib/permissions");
    for (const to of ["approved", "in_progress", "completed", "invoiced", "paid", "cancelled"] as const) {
      expect(canTransition("parts_advisor", to)).toBe(false);
    }
  });
});

describe("customers", () => {
  test("service and parts desks can look up and add customers; technicians cannot", () => {
    expect(can("service_advisor", "customers.edit")).toBe(true);
    expect(can("parts_advisor", "customers.edit")).toBe(true);
    expect(can("technician", "customers.view")).toBe(false);
  });
});

describe("service shortcuts", () => {
  test("the service desk, parts desk and admin can manage them; technicians cannot", () => {
    expect(can("shop_admin", "shortcuts.manage")).toBe(true);
    expect(can("service_advisor", "shortcuts.manage")).toBe(true);
    expect(can("parts_advisor", "shortcuts.manage")).toBe(true);
    expect(can("technician", "shortcuts.manage")).toBe(false);
  });
});

describe("admin-granted extra roles", () => {
  test("a technician also ticked for parts advisor can sell counter parts, but keeps technician's own-job limits", () => {
    expect(can("technician", "counterSales.create")).toBe(false);
    expect(can("technician", "counterSales.create", ["parts_advisor"])).toBe(true);
    // Granting parts advisor doesn't change what they can do with work order status.
    expect(can("technician", "workorders.invoice", ["parts_advisor"])).toBe(false);
  });

  test("a service advisor also ticked for parts advisor can see part cost", () => {
    expect(can("service_advisor", "parts.viewCost")).toBe(false);
    expect(can("service_advisor", "parts.viewCost", ["parts_advisor"])).toBe(true);
  });

  test("a grant never takes anything away — it only adds", () => {
    expect(can("parts_advisor", "counterSales.create", ["service_advisor"])).toBe(true);
    expect(can("parts_advisor", "workorders.addPart", ["service_advisor"])).toBe(true);
  });

  test("canAccessDepartment and departmentsFor see the grant", () => {
    expect(canAccessDepartment("technician", "parts", ["parts_advisor"])).toBe(true);
    expect(canAccessDepartment("technician", "parts")).toBe(false);
    expect(departmentsFor("technician", ["parts_advisor"])).toEqual(["service", "parts"]);
  });

  test("being also ticked for service advisor lets a technician move a work order fully, not just their own jobs", async () => {
    const { canTransition } = await import("../src/lib/permissions");
    expect(canTransition("technician", "invoiced")).toBe(false);
    expect(canTransition("technician", "invoiced", ["service_advisor"])).toBe(true);
    expect(canTransition("technician", "cancelled", ["service_advisor"])).toBe(true);
  });

  test("being also ticked for shop admin lifts the technician's own-job limit too", async () => {
    const { canTransition } = await import("../src/lib/permissions");
    expect(canTransition("technician", "paid", ["shop_admin"])).toBe(true);
  });

  test("an empty or missing grant behaves exactly like no grant at all", () => {
    expect(can("technician", "counterSales.create", [])).toBe(false);
    expect(canAccessDepartment("technician", "parts", [])).toBe(false);
  });
});

describe("splitRoles", () => {
  test("picks the highest-precedence ticked role as primary, the rest as extras", () => {
    expect(splitRoles(["technician", "parts_advisor"])).toEqual({ role: "parts_advisor", extraRoles: ["technician"] });
    expect(splitRoles(["technician", "shop_admin", "service_advisor"]))
      .toEqual({ role: "shop_admin", extraRoles: expect.arrayContaining(["service_advisor", "technician"]) });
    expect(splitRoles(["technician"])).toEqual({ role: "technician", extraRoles: [] });
  });
});
