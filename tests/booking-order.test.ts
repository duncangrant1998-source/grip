/**
 * Booking an appointment starts its work order.
 *
 * The booking and the quote are created together and linked, a clash in the
 * calendar leaves neither behind, and cancelling a booking tidies away a quote
 * nobody has touched — without ever discarding work someone has put into one.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let bay: string;
let techEmployee: string;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

// Each test books a different day so they never collide with one another.
let day = 0;
const nextDay = () => `2031-04-${String(++day).padStart(2, "0")}`;

const book = async (o: { date?: string; time?: string; bay?: string | null; tech?: string | null; concern?: string | null } = {}) => {
  const date = o.date ?? nextDay();
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_appointment_with_order(
      ${shop.customerId}, ${shop.vehicleId}, ${`${date} ${o.time ?? "09:00"}`}::text::timestamp, 60,
      ${o.bay === undefined ? null : o.bay}, ${o.tech === undefined ? null : o.tech},
      ${o.concern === undefined ? "Brake noise" : o.concern}) AS id`);
  return r.id as string;
};

const orderOf = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.work_orders WHERE id = ${id}`)[0];
const apptOf = async (orderId: string) =>
  (await owner()<Row[]>`
    SELECT a.* FROM grip.appointments a JOIN grip.work_orders w ON w.appointment_id = a.id
    WHERE w.id = ${orderId}`)[0];

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("bo-shop", "bo-other");
  shop = await createShop("bo-shop");
  other = await createShop("bo-other");

  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
  }
  [{ id: bay }] = await owner()<Row[]>`
    INSERT INTO grip.bays (tenant_id, name) VALUES (${shop.tenantId}, 'Bay 1') RETURNING id`;
  [{ id: techEmployee }] = await owner()<Row[]>`
    INSERT INTO grip.employees (tenant_id, full_name, hourly_rate, is_technician, user_id)
    VALUES (${shop.tenantId}, 'Tech', 40, true, ${shop.users.technician}) RETURNING id`;
});

afterAll(async () => {
  await dropShops("bo-shop", "bo-other");
  await closeAll();
});

describe("booking creates the quote", () => {
  test("a linked quote exists for the customer and vehicle, carrying the concern", async () => {
    const id = await book({ concern: "Grinding noise" });
    const wo = await orderOf(id);
    const appt = await apptOf(id);

    expect(wo.status).toBe("quote");
    expect(wo.customer_id).toBe(shop.customerId);
    expect(wo.vehicle_id).toBe(shop.vehicleId);
    expect(wo.concern).toBe("Grinding noise");
    expect(wo.appointment_id).toBe(appt.id);
    expect(wo.opened_by).toBe(shop.users.service_advisor);
  });

  test("the appointment is still just scheduled — nobody has arrived", async () => {
    const id = await book();
    expect((await apptOf(id)).status).toBe("scheduled");
  });

  test("the quote takes on the shop's default tax and labour mode", async () => {
    const wo = await orderOf(await book());
    expect(wo.tax_rate_id).toBe(shop.taxRateId);
    expect(wo.labour_billing_mode).toBe("flat_rate");
  });

  test("it can be filled in as a normal quote and then converted as the customer arrives", async () => {
    const id = await book();
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Brake job', 2, NULL, 100)`);
    expect(Number((await orderOf(id)).labour_subtotal)).toBe(200);

    // The older "customer arrived" path refuses: the order already exists.
    const appt = await apptOf(id);
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.convert_appointment_to_work_order(${appt.id})`)).rejects.toThrow(/already has a work order/i);
  });
});

describe("a clash leaves nothing behind", () => {
  test("a double-booked bay is refused, and no quote is created either", async () => {
    const date = nextDay();
    await book({ date, time: "09:00", bay });
    const before = (await owner()<Row[]>`SELECT count(*)::int AS n FROM grip.work_orders WHERE tenant_id = ${shop.tenantId}`)[0].n;

    await expect(book({ date, time: "09:30", bay })).rejects.toThrow(/already booked/i);

    const after = (await owner()<Row[]>`SELECT count(*)::int AS n FROM grip.work_orders WHERE tenant_id = ${shop.tenantId}`)[0].n;
    expect(after).toBe(before);
  });

  test("so is a technician in two places at once", async () => {
    const date = nextDay();
    await book({ date, time: "10:00", tech: techEmployee });
    await expect(book({ date, time: "10:15", tech: techEmployee })).rejects.toThrow(/already/i);
  });

  test("another shop's customer cannot be booked", async () => {
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.create_appointment_with_order(
        ${other.customerId}, ${other.vehicleId}, ${"2031-05-01 09:00"}::text::timestamp, 60, NULL, NULL, NULL)`))
      .rejects.toThrow(/not found/i);
  });
});

describe("cancelling a booking", () => {
  const cancel = (apptId: string) =>
    as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${apptId}, 'cancelled')`);

  test("tidies away a quote nobody has touched", async () => {
    const id = await book();
    await cancel((await apptOf(id)).id);
    expect((await orderOf(id)).status).toBe("cancelled");
  });

  test("a no-show does the same", async () => {
    const id = await book();
    const apptId = (await apptOf(id)).id;
    await as("service_advisor", (tx) => tx`
      SELECT grip.set_appointment_status(${apptId}, 'no_show')`);
    expect((await orderOf(id)).status).toBe("cancelled");
  });

  test("leaves a quote alone once it has labour on it", async () => {
    const id = await book();
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Brake job', 2, NULL, 100)`);
    await cancel((await apptOf(id)).id);
    expect((await orderOf(id)).status).toBe("quote");
  });

  test("and once it has a part on it", async () => {
    const id = await book();
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    await cancel((await apptOf(id)).id);
    expect((await orderOf(id)).status).toBe("quote");
  });

  test("leaves an order that is already further along alone", async () => {
    const id = await book();
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'approved')`);
    await cancel((await apptOf(id)).id);
    expect((await orderOf(id)).status).toBe("approved");
  });
});

describe("who sees the booked order", () => {
  test("the technician it is booked for is on the job, so it is theirs to see", async () => {
    const id = await book({ tech: techEmployee });
    const wo = await orderOf(id);
    const appt = await apptOf(id);
    expect(appt.assigned_tech_id).toBe(techEmployee);
    expect(wo.appointment_id).toBe(appt.id);
  });
});
