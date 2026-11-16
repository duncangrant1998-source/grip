/**
 * Ontario tax.
 *
 * Grip is sold to Ontario shops: one editable HST rate and an exempt option,
 * nothing else. These cover the rate setter, the Ontario setup a new shop gets,
 * and the thing that matters most — that changing the rate can never restate
 * what a customer was already charged.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const setRate = (bps: number, s: Shop = shop, role = "shop_admin") =>
  as(role, (tx) => tx`SELECT grip.set_hst_rate(${bps})`, s);

const hstBps = async (s: Shop = shop) => {
  const [row] = await owner()<Row[]>`
    SELECT c.rate_bps FROM grip.tax_rates r
    JOIN grip.tax_rate_components c ON c.tax_rate_id = r.id
    WHERE r.tenant_id = ${s.tenantId} AND lower(r.name) = 'hst'`;
  return row ? Number(row.rate_bps) : null;
};

const newOrder = async (s = shop) => {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_work_order(${s.customerId}, ${s.vehicleId}, 'Brake noise', NULL) AS id`, s);
  return r.id as string;
};

/** $200 labour + $100 part = $300 before tax. */
const withWork = async (id: string) => {
  await as("service_advisor", (tx) => tx`
    SELECT grip.add_labour_line(${id}, 'Brake job', 2, NULL, 100)`);
  await as("parts_advisor", (tx) => tx`
    SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
  return id;
};

const totals = async (id: string) => {
  const [row] = await owner()<Row[]>`
    SELECT subtotal, tax_total, total FROM grip.work_orders WHERE id = ${id}`;
  return { subtotal: Number(row.subtotal), tax: Number(row.tax_total), total: Number(row.total) };
};

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("on-shop", "on-other");
  shop = await createShop("on-shop", { "BP-1234": 20 });
  other = await createShop("on-other", { "BP-1234": 20 });

  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
    // createShop builds the HST half; the exempt option is the other half of
    // what every Ontario shop gets.
    await owner()`
      INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts)
      VALUES (${s.tenantId}, 'Exempt', false, false)`;
  }
});

afterAll(async () => {
  await dropShops("on-shop", "on-other");
  await closeAll();
});

describe("a new Ontario shop", () => {
  test("gets HST at 13% as its default and an exempt option", async () => {
    const [t] = await owner()<Row[]>`
      INSERT INTO grip.tenants (name, slug, status) VALUES ('Fresh', 'on-fresh', 'active') RETURNING id`;
    await owner()`SELECT grip.create_ontario_tax_rates(${t.id})`;

    const rates = await owner()<Row[]>`
      SELECT r.name, r.is_default, r.applies_to_labour, r.applies_to_parts, c.rate_bps
      FROM grip.tax_rates r LEFT JOIN grip.tax_rate_components c ON c.tax_rate_id = r.id
      WHERE r.tenant_id = ${t.id} ORDER BY r.name`;

    expect(rates.map((r) => r.name)).toEqual(["Exempt", "HST"]);
    expect(rates.find((r) => r.name === "HST")).toMatchObject({
      is_default: true, applies_to_labour: true, applies_to_parts: true, rate_bps: 1300,
    });
    expect(rates.find((r) => r.name === "Exempt")).toMatchObject({
      is_default: false, applies_to_labour: false, applies_to_parts: false, rate_bps: null,
    });
    await owner()`DELETE FROM grip.tenants WHERE id = ${t.id}`;
  });

  test("HST applies to both labour and parts", async () => {
    const id = await withWork(await newOrder());
    expect(await totals(id)).toEqual({ subtotal: 300, tax: 39, total: 339 });
  });

  test("HST prints as one named line, not a blended number", async () => {
    const id = await withWork(await newOrder());
    const taxes = await owner()<Row[]>`
      SELECT component_name, rate_bps, taxable_base, amount FROM grip.work_order_taxes
      WHERE work_order_id = ${id}`;
    expect(taxes).toHaveLength(1);
    expect(taxes[0]).toMatchObject({ component_name: "HST", rate_bps: 1300 });
    expect(Number(taxes[0].taxable_base)).toBe(300);
    expect(Number(taxes[0].amount)).toBe(39);
  });
});

describe("setting the HST rate", () => {
  test("changes what new work is charged", async () => {
    await setRate(1400);
    expect(await hstBps()).toBe(1400);
    const id = await withWork(await newOrder());
    expect(await totals(id)).toEqual({ subtotal: 300, tax: 42, total: 342 });
    await setRate(1300);
  });

  test("recalculates an open order that is already using it", async () => {
    const id = await withWork(await newOrder());
    expect((await totals(id)).tax).toBe(39);
    await setRate(1500);
    expect((await totals(id)).tax).toBe(45);
    await setRate(1300);
    expect((await totals(id)).tax).toBe(39);
  });

  test("never restates an invoice already issued", async () => {
    const id = await withWork(await newOrder());
    await as("service_advisor", async (tx) => {
      for (const to of ["approved", "in_progress", "completed", "invoiced"]) {
        await tx`SELECT grip.transition_work_order(${id}, ${to}::grip.work_order_status)`;
      }
    });

    await setRate(1500);
    const taxes = await owner()<Row[]>`
      SELECT component_name, rate_bps, amount FROM grip.work_order_taxes WHERE work_order_id = ${id}`;
    expect(taxes.map((t) => [t.component_name, t.rate_bps, Number(t.amount)])).toEqual([["HST", 1300, 39]]);
    expect((await totals(id)).total).toBe(339);
    await setRate(1300);
  });

  test("keeps it to one component — no stacking up every time it is set", async () => {
    await setRate(1300);
    await setRate(1400);
    await setRate(1300);
    const [row] = await owner()<Row[]>`
      SELECT count(*)::int AS n FROM grip.tax_rate_components c
      JOIN grip.tax_rates r ON r.id = c.tax_rate_id
      WHERE r.tenant_id = ${shop.tenantId} AND lower(r.name) = 'hst'`;
    expect(row.n).toBe(1);
  });

  test("0% is allowed, so a shop below the registration threshold can switch it off", async () => {
    await setRate(0);
    const id = await withWork(await newOrder());
    expect(await totals(id)).toEqual({ subtotal: 300, tax: 0, total: 300 });
    await setRate(1300);
  });

  test.each([-1, 3001, null])("refuses a nonsense rate: %s", async (bps) => {
    await expect(as("shop_admin", (tx) => tx`SELECT grip.set_hst_rate(${bps})`)).rejects.toThrow();
    expect(await hstBps()).toBe(1300);
  });

  test("the change is written to the audit log", async () => {
    await setRate(1400);
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE tenant_id = ${shop.tenantId} AND action = 'tax.hst_rate_changed'
      ORDER BY created_at DESC LIMIT 1`;
    expect(row.actor_user_id).toBe(shop.users.shop_admin);
    expect(row.diff).toMatchObject({ from_bps: 1300, to_bps: 1400 });
    await setRate(1300);
  });
});

describe("the exempt option", () => {
  test("charges nothing on a work order", async () => {
    const [ex] = await owner()<Row[]>`
      SELECT id FROM grip.tax_rates WHERE tenant_id = ${shop.tenantId} AND name = 'Exempt'`;
    const id = await withWork(await newOrder());
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${ex.id})`);
    expect(await totals(id)).toEqual({ subtotal: 300, tax: 0, total: 300 });
    expect(await owner()<Row[]>`
      SELECT 1 FROM grip.work_order_taxes WHERE work_order_id = ${id}`).toHaveLength(0);
  });

  test("set on the customer, it carries onto their new work orders", async () => {
    const [ex] = await owner()<Row[]>`
      SELECT id FROM grip.tax_rates WHERE tenant_id = ${shop.tenantId} AND name = 'Exempt'`;
    const [cust] = await owner()<Row[]>`
      INSERT INTO grip.customers (tenant_id, display_name, tax_rate_id)
      VALUES (${shop.tenantId}, 'Six Nations Fleet', ${ex.id}) RETURNING id`;
    const [veh] = await owner()<Row[]>`
      INSERT INTO grip.vehicles (tenant_id, customer_id, make, model)
      VALUES (${shop.tenantId}, ${cust.id}, 'Ford', 'F-150') RETURNING id`;

    const [r] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_work_order(${cust.id}, ${veh.id}, NULL, NULL) AS id`);
    const [wo] = await owner()<Row[]>`SELECT tax_rate_id FROM grip.work_orders WHERE id = ${r.id}`;
    expect(wo.tax_rate_id).toBe(ex.id);
  });
});

describe("the HST number", () => {
  test("is stored per shop and is nobody else's business", async () => {
    await as("shop_admin", (tx) => tx`
      INSERT INTO grip.tenant_settings (tenant_id, hst_number) VALUES (${shop.tenantId}, '123456789RT0001')
      ON CONFLICT (tenant_id) DO UPDATE SET hst_number = '123456789RT0001'`);

    const mine = await as("shop_admin", (tx) => tx<Row[]>`SELECT hst_number FROM grip.tenant_settings`);
    expect(mine.map((r) => r.hst_number)).toEqual(["123456789RT0001"]);

    const theirs = await as("shop_admin", (tx) => tx<Row[]>`SELECT hst_number FROM grip.tenant_settings`, other);
    expect(theirs.every((r) => r.hst_number !== "123456789RT0001")).toBe(true);
  });
});

describe("tenant isolation", () => {
  test("one shop's rate change leaves the other alone", async () => {
    await setRate(1400);
    expect(await hstBps(shop)).toBe(1400);
    expect(await hstBps(other)).toBe(1300);
    await setRate(1300);
  });

  test("a shop cannot reach into another shop's HST rate", async () => {
    const [theirHst] = await owner()<Row[]>`
      SELECT id FROM grip.tax_rates WHERE tenant_id = ${other.tenantId} AND lower(name) = 'hst'`;
    await as("shop_admin", (tx) => tx`
      UPDATE grip.tax_rate_components SET rate_bps = 9900 WHERE tax_rate_id = ${theirHst.id}`);
    expect(await hstBps(other)).toBe(1300);
  });
});
