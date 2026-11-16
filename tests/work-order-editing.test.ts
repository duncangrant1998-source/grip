/**
 * Editing a work order in place: every field on a labour line, who last touched
 * it, the notes written for the customer, and moving the order to another
 * customer or vehicle.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let secondVehicle: string;
let secondCustomer: string;
let secondCustomerVehicle: string;
let exemptRate: string;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const newOrder = async () => {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_work_order(${shop.customerId}, ${shop.vehicleId}, 'Noise', NULL) AS id`);
  return r.id as string;
};

const addLine = async (id: string, role = "service_advisor") =>
  (await as(role, (tx) => tx<Row[]>`
    SELECT grip.add_labour_line(${id}, 'Brake job', 2, 1.8, 100, 'flat_rate') AS id`))[0].id as string;

const line = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.work_order_labour_lines WHERE id = ${id}`)[0];
const order = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.work_orders WHERE id = ${id}`)[0];

const edit = (
  lineId: string,
  o: Partial<{ desc: string; hours: number; actual: number | null; rate: number; mode: string; tech: string | null; taxable: boolean }> = {},
  role = "service_advisor",
) => as(role, (tx) => tx`
  SELECT grip.update_labour_line(${lineId}, ${o.desc ?? "Brake job"}, ${o.hours ?? 2},
    ${o.actual === undefined ? 1.8 : o.actual}, ${o.rate ?? 100},
    ${o.mode ?? "flat_rate"}::grip.labour_billing_mode, ${o.tech ?? null}, ${o.taxable ?? true})`);

const go = async (id: string, to: string) => {
  const steps = ["quote", "approved", "in_progress", "completed", "invoiced"];
  const from = steps.indexOf((await order(id)).status);
  for (const s of steps.slice(from + 1, steps.indexOf(to) + 1)) {
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, ${s}::grip.work_order_status)`);
  }
};

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("we-shop", "we-other");
  shop = await createShop("we-shop");
  other = await createShop("we-other");

  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
  }
  [{ id: exemptRate }] = await owner()<Row[]>`
    INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts)
    VALUES (${shop.tenantId}, 'Exempt', false, false) RETURNING id`;

  [{ id: secondVehicle }] = await owner()<Row[]>`
    INSERT INTO grip.vehicles (tenant_id, customer_id, make, model)
    VALUES (${shop.tenantId}, ${shop.customerId}, 'Honda', 'Civic') RETURNING id`;
  [{ id: secondCustomer }] = await owner()<Row[]>`
    INSERT INTO grip.customers (tenant_id, display_name, tax_rate_id, exempt_reason, exempt_reference)
    VALUES (${shop.tenantId}, 'Fleet Customer', ${exemptRate}, 'resale', '123456789RT0001') RETURNING id`;
  [{ id: secondCustomerVehicle }] = await owner()<Row[]>`
    INSERT INTO grip.vehicles (tenant_id, customer_id, make, model)
    VALUES (${shop.tenantId}, ${secondCustomer}, 'Ford', 'Transit') RETURNING id`;
});

afterAll(async () => {
  await dropShops("we-shop", "we-other");
  await closeAll();
});

describe("every field on a labour line is editable", () => {
  test("description, hours, actual hours and rate", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await edit(l, { desc: "Brake job + rotors", hours: 3, actual: 2.5, rate: 120 });

    const row = await line(l);
    expect(row.description).toBe("Brake job + rotors");
    expect(Number(row.billed_hours)).toBe(3);
    expect(Number(row.actual_hours)).toBe(2.5);
    expect(Number(row.rate)).toBe(120);
    expect(Number((await order(id)).labour_subtotal)).toBe(360);
  });

  test("billing mode: switching to straight time bills the hours worked", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await edit(l, { mode: "straight_time", hours: 2.5 });

    const row = await line(l);
    expect(row.billing_mode).toBe("straight_time");
    expect(Number(row.billed_hours)).toBe(2.5);
    expect(Number(row.actual_hours)).toBe(2.5);          // the two columns become one number
  });

  test("billing mode: switching back keeps the hours and lets actual differ again", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await edit(l, { mode: "straight_time", hours: 2.5 });
    await edit(l, { mode: "flat_rate", hours: 2.5, actual: 2 });
    const row = await line(l);
    expect(row.billing_mode).toBe("flat_rate");
    expect(Number(row.actual_hours)).toBe(2);
  });

  test("tax can be turned off for one line and the totals follow", async () => {
    const id = await newOrder();
    const l = await addLine(id);                     // $200, taxable
    expect(Number((await order(id)).tax_total)).toBe(26);
    await edit(l, { taxable: false });
    expect(Number((await order(id)).tax_total)).toBe(0);
    await edit(l, { taxable: true });
    expect(Number((await order(id)).tax_total)).toBe(26);
  });

  test("a line can be reassigned to a technician and back", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    const [emp] = await owner()<Row[]>`
      INSERT INTO grip.employees (tenant_id, full_name, hourly_rate, is_technician)
      VALUES (${shop.tenantId}, 'Alex', 40, true) RETURNING id`;
    await edit(l, { tech: emp.id });
    expect((await line(l)).tech_id).toBe(emp.id);
    await edit(l, { tech: null });
    expect((await line(l)).tech_id).toBeNull();
  });

  test("bad input is refused and nothing changes", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await expect(edit(l, { desc: "   " })).rejects.toThrow(/needs a description/i);
    await expect(edit(l, { hours: -1 })).rejects.toThrow(/cannot be negative/i);
    await expect(edit(l, { rate: -5 })).rejects.toThrow(/cannot be negative/i);
    expect((await line(l)).description).toBe("Brake job");
  });

  test("saving an unchanged line is a no-op: no edit recorded, no noise in the trail", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await edit(l);
    expect((await line(l)).edited_by_user_id).toBeNull();
    const rows = await owner()<Row[]>`
      SELECT 1 FROM grip.audit_log WHERE entity_id = ${id} AND action = 'labour.edited'`;
    expect(rows).toHaveLength(0);
  });
});

describe("added by, edited by", () => {
  test("a fresh line has an author and no editor", async () => {
    const l = await addLine(await newOrder());
    const row = await line(l);
    expect(row.added_by_user_id).toBe(shop.users.service_advisor);
    expect(row.edited_by_user_id).toBeNull();
  });

  test("another person's edit is recorded against them, the author stays", async () => {
    const l = await addLine(await newOrder(), "service_advisor");
    await edit(l, { hours: 3 }, "shop_admin");
    const row = await line(l);
    expect(row.added_by_user_id).toBe(shop.users.service_advisor);
    expect(row.edited_by_user_id).toBe(shop.users.shop_admin);
    expect(row.edited_at).not.toBeNull();
  });

  test("the editor is whoever edited last", async () => {
    const l = await addLine(await newOrder(), "service_advisor");
    await edit(l, { hours: 3 }, "shop_admin");
    await edit(l, { hours: 4 }, "technician");
    expect((await line(l)).edited_by_user_id).toBe(shop.users.technician);
  });

  test("an edit appears in the activity trail with who made it", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await edit(l, { desc: "Brake job, revised" }, "shop_admin");
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE entity_id = ${id} AND action = 'labour.edited'`;
    expect(row.actor_user_id).toBe(shop.users.shop_admin);
    expect(row.diff.description).toBe("Brake job, revised");
  });
});

describe("when labour can be edited", () => {
  test("open on a quote, an approved order and one in progress", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    for (const to of ["quote", "approved", "in_progress"]) {
      await go(id, to);
      await expect(edit(l, { hours: 2.1 })).resolves.toBeDefined();
      await edit(l, { hours: 2 });
    }
  });

  test("still open once the job is completed, because hours are corrected then", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await go(id, "completed");
    await edit(l, { hours: 2.5 });
    expect(Number((await line(l)).billed_hours)).toBe(2.5);
    expect(Number((await order(id)).labour_subtotal)).toBe(250);
  });

  test("locked for good once invoiced", async () => {
    const id = await newOrder();
    const l = await addLine(id);
    await go(id, "invoiced");
    await expect(edit(l, { hours: 9 })).rejects.toThrow(/cannot change labour/i);
    await expect(as("service_advisor", (tx) => tx`SELECT grip.remove_labour_line(${l})`))
      .rejects.toThrow(/cannot change labour/i);
    expect(Number((await line(l)).billed_hours)).toBe(2);
  });

  test("another shop's line cannot be edited", async () => {
    const l = await addLine(await newOrder());
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.update_labour_line(${l}, 'x', 1, NULL, 1, 'flat_rate', NULL, true)`, other))
      .rejects.toThrow(/labour line not found/i);
  });
});

describe("notes for the customer", () => {
  const notes = (id: string, text: string | null, role = "service_advisor") =>
    as(role, (tx) => tx`SELECT grip.set_work_order_notes(${id}, ${text})`);

  test("saved, trimmed, and cleared by emptying them", async () => {
    const id = await newOrder();
    await notes(id, "  Rotors are scored. Recommend replacing.  ");
    expect((await order(id)).notes).toBe("Rotors are scored. Recommend replacing.");
    await notes(id, "   ");
    expect((await order(id)).notes).toBeNull();
  });

  test("editable in every status except that they need an order to exist — even once invoiced", async () => {
    const id = await newOrder();
    await go(id, "invoiced");
    await notes(id, "Paid by e-transfer");
    expect((await order(id)).notes).toBe("Paid by e-transfer");
  });

  test("capped at 5,000 characters", async () => {
    const id = await newOrder();
    await expect(notes(id, "x".repeat(5001))).rejects.toThrow(/limited to 5,000/i);
  });

  test("an unchanged save leaves no trace", async () => {
    const id = await newOrder();
    await notes(id, "Same");
    await notes(id, "Same");
    const rows = await owner()<Row[]>`
      SELECT 1 FROM grip.audit_log WHERE entity_id = ${id} AND action = 'work_order.notes_edited'`;
    expect(rows).toHaveLength(1);
  });

  test("another shop's order has no notes to set", async () => {
    const id = await newOrder();
    await expect(notes(id, "hi", "shop_admin").then(() =>
      as("shop_admin", (tx) => tx`SELECT grip.set_work_order_notes(${id}, 'x')`, other)))
      .rejects.toThrow(/work order not found/i);
  });
});

describe("the concern and mileage", () => {
  const details = (id: string, concern: string | null, km: number | null) =>
    as("service_advisor", (tx) => tx`SELECT grip.set_work_order_details(${id}, ${concern}, ${km})`);

  test("can be corrected, and mileage only ever moves the vehicle forward", async () => {
    const id = await newOrder();
    await owner()`UPDATE grip.vehicles SET current_mileage = 50000 WHERE id = ${shop.vehicleId}`;
    await details(id, "Grinding when braking", 60000);
    expect((await order(id)).concern).toBe("Grinding when braking");
    const [v1] = await owner()<Row[]>`SELECT current_mileage FROM grip.vehicles WHERE id = ${shop.vehicleId}`;
    expect(v1.current_mileage).toBe(60000);

    await details(id, "Grinding", 40000);              // an older reading must not lower it
    const [v2] = await owner()<Row[]>`SELECT current_mileage FROM grip.vehicles WHERE id = ${shop.vehicleId}`;
    expect(v2.current_mileage).toBe(60000);
  });

  test("locked once invoiced", async () => {
    const id = await newOrder();
    await go(id, "invoiced");
    await expect(details(id, "late", null)).rejects.toThrow(/cannot be changed/i);
  });

  test("negative mileage is refused", async () => {
    await expect(details(await newOrder(), "x", -1)).rejects.toThrow(/cannot be negative/i);
  });
});

describe("changing who the order is for", () => {
  const move = (id: string, customer: string, vehicle: string, s: Shop = shop) =>
    as("service_advisor", (tx) => tx`SELECT grip.set_work_order_customer(${id}, ${customer}, ${vehicle})`, s);

  test("another vehicle of the same customer keeps the tax arrangement", async () => {
    const id = await newOrder();
    await move(id, shop.customerId, secondVehicle);
    const wo = await order(id);
    expect(wo.vehicle_id).toBe(secondVehicle);
    expect(wo.customer_id).toBe(shop.customerId);
    expect(wo.tax_rate_id).toBe(shop.taxRateId);
  });

  test("a different customer takes on their tax arrangement, exemption included", async () => {
    const id = await newOrder();
    await addLine(id);
    await move(id, secondCustomer, secondCustomerVehicle);
    const wo = await order(id);
    expect(wo.customer_id).toBe(secondCustomer);
    expect(wo.tax_rate_id).toBe(exemptRate);
    expect(wo.exempt_reason).toBe("resale");
    expect(Number(wo.tax_total)).toBe(0);
  });

  test("the vehicle must belong to the customer", async () => {
    const id = await newOrder();
    await expect(move(id, shop.customerId, secondCustomerVehicle)).rejects.toThrow(/does not belong/i);
  });

  test("cannot move to a customer from another shop", async () => {
    const id = await newOrder();
    await expect(move(id, other.customerId, other.vehicleId)).rejects.toThrow(/customer not found/i);
    expect((await order(id)).customer_id).toBe(shop.customerId);
  });

  test("locked once invoiced", async () => {
    const id = await newOrder();
    await go(id, "invoiced");
    await expect(move(id, shop.customerId, secondVehicle)).rejects.toThrow(/cannot be changed/i);
  });

  test("a booked appointment follows its order", async () => {
    const [appt] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_appointment(${shop.customerId}, ${shop.vehicleId},
        ${"2030-03-12 09:00"}::text::timestamp, 60, NULL, NULL, NULL) AS id`);
    const [wo] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.convert_appointment_to_work_order(${appt.id}) AS id`);
    await move(wo.id, secondCustomer, secondCustomerVehicle);
    const [a] = await owner()<Row[]>`SELECT customer_id, vehicle_id FROM grip.appointments WHERE id = ${appt.id}`;
    expect(a.customer_id).toBe(secondCustomer);
    expect(a.vehicle_id).toBe(secondCustomerVehicle);
  });

  test("the change is written to the activity trail", async () => {
    const id = await newOrder();
    await move(id, secondCustomer, secondCustomerVehicle);
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE entity_id = ${id} AND action = 'work_order.customer_changed'`;
    expect(row.actor_user_id).toBe(shop.users.service_advisor);
    expect(row.diff.customer).toBe("Fleet Customer");
  });
});
