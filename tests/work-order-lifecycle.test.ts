/**
 * The work order spine: creation defaults, labour in both billing modes, tax
 * selection, the state machine, and the audit trail that records which desk
 * added what.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, stockOf, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let exemptRateId: string;
let exemptCustomerId: string;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

type Row = Record<string, any>;

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("wo-shop", "wo-other");
  shop = await createShop("wo-shop", { "BP-1234": 10 });
  other = await createShop("wo-other");

  await owner()`
    INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id)
    VALUES (${shop.tenantId}, 120.00, 'flat_rate', ${shop.taxRateId})`;

  // A tax-exempt fleet customer: overrides the shop default.
  const [exempt] = await owner()<{ id: string }[]>`
    INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts)
    VALUES (${shop.tenantId}, 'Exempt', false, false) RETURNING id`;
  exemptRateId = exempt.id;
  const [cust] = await owner()<{ id: string }[]>`
    INSERT INTO grip.customers (tenant_id, display_name, tax_rate_id)
    VALUES (${shop.tenantId}, 'City Fleet Services', ${exemptRateId}) RETURNING id`;
  exemptCustomerId = cust.id;
  await owner()`
    INSERT INTO grip.vehicles (tenant_id, customer_id, make, model)
    VALUES (${shop.tenantId}, ${exemptCustomerId}, 'Ford', 'Transit')`;
});

afterAll(async () => {
  await dropShops("wo-shop", "wo-other");
  await closeAll();
});

const newOrder = async (mileage: number | null = null, s = shop) => {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_work_order(${s.customerId}, ${s.vehicleId}, 'Brake noise', ${mileage}) AS id`, s);
  return r.id as string;
};

const get = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.work_orders WHERE id = ${id}`)[0];

describe("creating a work order", () => {
  test("starts as a quote with the shop's default tax and labour mode", async () => {
    const id = await newOrder();
    const wo = await get(id);
    expect(wo.status).toBe("quote");
    expect(wo.tax_rate_id).toBe(shop.taxRateId);
    expect(wo.labour_billing_mode).toBe("flat_rate");
    expect(wo.opened_by).toBe(shop.users.service_advisor);
  });

  test("numbers run per shop and increase", async () => {
    const a = await get(await newOrder());
    const b = await get(await newOrder());
    expect(b.number).toBe(a.number + 1);
  });

  test("a tax-exempt customer overrides the shop default", async () => {
    const [veh] = await owner()<Row[]>`SELECT id FROM grip.vehicles WHERE customer_id = ${exemptCustomerId}`;
    const [r] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_work_order(${exemptCustomerId}, ${veh.id}, NULL, NULL) AS id`);
    expect((await get(r.id)).tax_rate_id).toBe(exemptRateId);
  });

  test("the vehicle must belong to the customer", async () => {
    const [otherVeh] = await owner()<Row[]>`SELECT id FROM grip.vehicles WHERE customer_id = ${exemptCustomerId}`;
    await expect(
      as("service_advisor", (tx) => tx`
        SELECT grip.create_work_order(${shop.customerId}, ${otherVeh.id}, NULL, NULL)`),
    ).rejects.toThrow(/does not belong/i);
  });

  test("cannot use another shop's customer", async () => {
    await expect(
      as("service_advisor", (tx) => tx`
        SELECT grip.create_work_order(${other.customerId}, ${other.vehicleId}, NULL, NULL)`),
    ).rejects.toThrow(/customer not found/i);
  });

  test("mileage history only moves forward", async () => {
    await newOrder(50_000);
    await newOrder(40_000); // a typo or an older reading must not lower it
    const [v] = await owner()<Row[]>`SELECT current_mileage FROM grip.vehicles WHERE id = ${shop.vehicleId}`;
    expect(v.current_mileage).toBe(50_000);
  });
});

describe("labour: flat rate and straight time", () => {
  test("flat rate bills book hours and keeps actual hours separately", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`
      SELECT grip.add_labour_line(${id}, 'Brake job', 2.4, 2.1, 100, 'flat_rate')`);

    const [l] = await owner()<Row[]>`SELECT * FROM grip.work_order_labour_lines WHERE work_order_id = ${id}`;
    expect(Number(l.billed_hours)).toBe(2.4);
    expect(Number(l.actual_hours)).toBe(2.1);
    expect(Number((await get(id)).labour_subtotal)).toBe(240);
  });

  test("straight time bills the hours worked, whatever else is passed", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`
      SELECT grip.add_labour_line(${id}, 'Teardown', 3.5, 9, 100, 'straight_time')`);

    const [l] = await owner()<Row[]>`SELECT * FROM grip.work_order_labour_lines WHERE work_order_id = ${id}`;
    expect(Number(l.billed_hours)).toBe(3.5);
    expect(Number(l.actual_hours)).toBe(3.5); // billed = actual by construction
    expect(Number((await get(id)).labour_subtotal)).toBe(350);
  });

  test("one order can mix both modes", async () => {
    const id = await newOrder();
    await as("service_advisor", async (tx) => {
      await tx`SELECT grip.add_labour_line(${id}, 'Diagnostic (book)', 1, NULL, 100, 'flat_rate')`;
      await tx`SELECT grip.add_labour_line(${id}, 'Teardown (actual)', 2.5, NULL, 100, 'straight_time')`;
    });
    expect(Number((await get(id)).labour_subtotal)).toBe(350);
  });

  test("a line defaults to the order's mode and the shop's labour rate", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_labour_mode(${id}, 'straight_time')`);
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Inspection', 1.0)`);

    const [l] = await owner()<Row[]>`SELECT * FROM grip.work_order_labour_lines WHERE work_order_id = ${id}`;
    expect(l.billing_mode).toBe('straight_time');
    expect(Number(l.rate)).toBe(120); // tenant_settings.default_labour_rate
  });

  test("changing the order's mode does not reprice lines already written", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Alignment', 1.5, 1.0, 100)`);
    const before = Number((await get(id)).labour_subtotal);

    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_labour_mode(${id}, 'straight_time')`);
    expect(Number((await get(id)).labour_subtotal)).toBe(before);
  });

  test("technician efficiency reads off the same columns in either mode", async () => {
    const id = await newOrder();
    await as("service_advisor", async (tx) => {
      await tx`SELECT grip.add_labour_line(${id}, 'Flat', 2, 1.6, 100, 'flat_rate')`;
      await tx`SELECT grip.add_labour_line(${id}, 'Straight', 2, NULL, 100, 'straight_time')`;
    });
    const [e] = await owner()<Row[]>`
      SELECT sum(billed_hours) AS billed, sum(actual_hours) AS actual
      FROM grip.work_order_labour_lines WHERE work_order_id = ${id}`;
    // billed 4.0 / actual 3.6 — a straight-time line contributes exactly 1:1.
    expect(Number(e.billed) / Number(e.actual)).toBeCloseTo(4 / 3.6, 3);
  });

  test("rejects negative hours and blank descriptions", async () => {
    const id = await newOrder();
    await expect(as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'x', -1)`))
      .rejects.toThrow(/negative/i);
    await expect(as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, '  ', 1)`))
      .rejects.toThrow(/description/i);
  });

  test("editing and removing a line recalculates the order", async () => {
    const id = await newOrder();
    const [r] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.add_labour_line(${id}, 'Job', 1, NULL, 100, 'flat_rate') AS lid`);
    await as("service_advisor", (tx) => tx`
      SELECT grip.update_labour_line(${r.lid}, 'Job (revised)', 3, NULL, 100, 'flat_rate', NULL, true)`);
    expect(Number((await get(id)).labour_subtotal)).toBe(300);

    await as("service_advisor", (tx) => tx`SELECT grip.remove_labour_line(${r.lid})`);
    expect(Number((await get(id)).labour_subtotal)).toBe(0);
  });
});

describe("tax is selectable per document and calculated automatically", () => {
  const withLabourAndPart = async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Work', 2, NULL, 100, 'flat_rate')`);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    return id; // $200 labour + $100 part = $300
  };

  test("the default rate charges Ontario HST as its own named line", async () => {
    const id = await withLabourAndPart();
    const taxes = await owner()<Row[]>`
      SELECT component_name, amount FROM grip.work_order_taxes WHERE work_order_id = ${id} ORDER BY sort_order`;
    expect(taxes.map((t) => [t.component_name, Number(t.amount)])).toEqual([["HST", 39]]);
    expect(Number((await get(id)).total)).toBe(339);
  });

  test("switching to an exempt rate recalculates to no tax", async () => {
    const id = await withLabourAndPart();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptRateId})`);
    const wo = await get(id);
    expect(Number(wo.tax_total)).toBe(0);
    expect(Number(wo.total)).toBe(300);
  });

  test("a shop can choose no tax at all", async () => {
    const id = await withLabourAndPart();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, NULL)`);
    expect(Number((await get(id)).tax_total)).toBe(0);
  });

  test("cannot select another shop's tax rate", async () => {
    const id = await newOrder();
    await expect(
      as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${other.taxRateId})`),
    ).rejects.toThrow(/tax rate not found/i);
  });

  test("tax charged is frozen on the document: editing the rate later changes nothing", async () => {
    const id = await withLabourAndPart();
    await as("service_advisor", async (tx) => {
      await tx`SELECT grip.transition_work_order(${id}, 'approved')`;
      await tx`SELECT grip.transition_work_order(${id}, 'in_progress')`;
      await tx`SELECT grip.transition_work_order(${id}, 'completed')`;
      await tx`SELECT grip.transition_work_order(${id}, 'invoiced')`;
    });

    // Ontario later raises HST to 14%.
    await owner()`UPDATE grip.tax_rate_components SET rate_bps = 1400
                  WHERE tax_rate_id = ${shop.taxRateId} AND name = 'HST'`;

    const taxes = await owner()<Row[]>`
      SELECT component_name, rate_bps, amount FROM grip.work_order_taxes
      WHERE work_order_id = ${id} ORDER BY sort_order`;
    expect(taxes.map((t) => [t.component_name, t.rate_bps, Number(t.amount)]))
      .toEqual([["HST", 1300, 39]]);
    expect(Number((await get(id)).total)).toBe(339);

    await owner()`UPDATE grip.tax_rate_components SET rate_bps = 1300
                  WHERE tax_rate_id = ${shop.taxRateId} AND name = 'HST'`;
  });

  test("tax cannot be changed once invoiced", async () => {
    const id = await withLabourAndPart();
    await as("service_advisor", async (tx) => {
      for (const to of ["approved", "in_progress", "completed", "invoiced"]) {
        await tx`SELECT grip.transition_work_order(${id}, ${to}::grip.work_order_status)`;
      }
    });
    await expect(
      as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, NULL)`),
    ).rejects.toThrow(/cannot be changed/i);
  });
});

describe("the state machine", () => {
  const go = (id: string, to: string, role = "service_advisor") =>
    as(role, (tx) => tx`SELECT grip.transition_work_order(${id}, ${to}::grip.work_order_status)`);

  test("quote to paid, step by step, stamping each timestamp", async () => {
    const id = await newOrder();
    for (const to of ["approved", "in_progress", "completed", "invoiced", "paid"]) {
      await go(id, to);
      expect((await get(id)).status).toBe(to);
    }
    const wo = await get(id);
    expect(wo.approved_at).not.toBeNull();
    expect(wo.completed_at).not.toBeNull();
    expect(wo.invoiced_at).not.toBeNull();
    expect(wo.paid_at).not.toBeNull();
  });

  test.each([
    ["quote", "completed"],
    ["quote", "invoiced"],
    ["quote", "paid"],
    ["approved", "invoiced"],
  ])("cannot jump from %s to %s", async (from, to) => {
    const id = await newOrder();
    if (from === "approved") await go(id, "approved");
    await expect(go(id, to)).rejects.toThrow(/cannot move to/i);
  });

  test("an invoiced order cannot be cancelled or reopened", async () => {
    const id = await newOrder();
    for (const to of ["approved", "in_progress", "completed", "invoiced"]) await go(id, to);
    await expect(go(id, "cancelled")).rejects.toThrow(/cannot move to/i);
    await expect(go(id, "in_progress")).rejects.toThrow(/cannot move to/i);
  });

  test("completing consumes reserved stock; the invoice step does not touch it again", async () => {
    const id = await newOrder();
    const before = await stockOf(shop.parts["BP-1234"]);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 2, ${shop.users.parts_advisor})`);
    for (const to of ["approved", "in_progress"]) await go(id, to);
    expect((await stockOf(shop.parts["BP-1234"])).reserved).toBe(before.reserved + 2);

    await go(id, "completed");
    const done = await stockOf(shop.parts["BP-1234"]);
    expect(done.onHand).toBe(before.onHand - 2);
    expect(done.reserved).toBe(before.reserved);

    await go(id, "invoiced");
    expect(await stockOf(shop.parts["BP-1234"])).toEqual(done);
  });

  test("cancelling releases what the order had reserved", async () => {
    const id = await newOrder();
    const before = await stockOf(shop.parts["BP-1234"]);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 3, ${shop.users.parts_advisor})`);
    await go(id, "cancelled");
    expect(await stockOf(shop.parts["BP-1234"])).toEqual(before);
  });

  test("parts lock once the job is completed, labour stays open until it is invoiced", async () => {
    const id = await newOrder();
    for (const to of ["approved", "in_progress", "completed"]) await go(id, to);

    // Hours get corrected when the job is closed out, so labour is still editable.
    await expect(as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Late', 1)`))
      .resolves.toBeDefined();
    // Parts have been used up by completing, so they are not.
    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`))
      .rejects.toThrow(/cannot add parts/i);

    await go(id, "invoiced");
    await expect(as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Too late', 1)`))
      .rejects.toThrow(/cannot change labour/i);
  });
});

describe("one live work order, two desks, and a clear trail", () => {
  test("service and parts both add to the same order and each line names its author", async () => {
    const id = await newOrder();

    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Replace pads', 1.5, NULL, 100)`);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);

    const [labour] = await owner()<Row[]>`
      SELECT added_by_user_id FROM grip.work_order_labour_lines WHERE work_order_id = ${id}`;
    const [part] = await owner()<Row[]>`
      SELECT added_by_user_id FROM grip.work_order_part_lines WHERE work_order_id = ${id}`;
    expect(labour.added_by_user_id).toBe(shop.users.service_advisor);
    expect(part.added_by_user_id).toBe(shop.users.parts_advisor);

    // And both appear in the one document's total.
    const wo = await get(id);
    expect(Number(wo.labour_subtotal)).toBe(150);
    expect(Number(wo.parts_subtotal)).toBe(100);
  });

  test("the activity log records who did what, in order", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Pads', 1, NULL, 100)`);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'approved')`);

    const log = await owner()<Row[]>`
      SELECT a.action, u.role FROM grip.audit_log a
      JOIN grip.users u ON u.id = a.actor_user_id
      WHERE a.entity_id = ${id} ORDER BY a.id`;
    expect(log.map((l) => [l.action, l.role])).toEqual([
      ["work_order.created", "service_advisor"],
      ["labour.added", "service_advisor"],
      ["part.added", "parts_advisor"],
      ["work_order.approved", "service_advisor"],
    ]);
  });

  test("the actor comes from the verified session, not from anything the caller passes", async () => {
    const id = await newOrder();
    // Signed in as the technician; nothing the SQL caller supplies can say otherwise.
    await as("technician", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Bolt check', 0.5, NULL, 100)`);

    const [row] = await owner()<Row[]>`
      SELECT added_by_user_id FROM grip.work_order_labour_lines WHERE work_order_id = ${id}`;
    expect(row.added_by_user_id).toBe(shop.users.technician);
  });

  test("edits and removals are logged too", async () => {
    const id = await newOrder();
    const [r] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.add_labour_line(${id}, 'Job', 1, NULL, 100) AS lid`);
    await as("service_advisor", (tx) => tx`SELECT grip.update_labour_line(${r.lid}, 'Job', 2, NULL, 100, 'flat_rate', NULL, true)`);
    await as("service_advisor", (tx) => tx`SELECT grip.remove_labour_line(${r.lid})`);

    const actions = (await owner()<Row[]>`
      SELECT action FROM grip.audit_log WHERE entity_id = ${id} ORDER BY id`).map((a) => a.action);
    expect(actions).toEqual(["work_order.created", "labour.added", "labour.edited", "labour.removed"]);
  });

  test("another shop cannot read this order's activity", async () => {
    const id = await newOrder();
    const seen = await as("shop_admin", (tx) => tx<Row[]>`
      SELECT id FROM grip.audit_log WHERE entity_id = ${id}`, other);
    expect(seen).toHaveLength(0);
  });
});
