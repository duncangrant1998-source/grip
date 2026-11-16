/**
 * Parts, organised and taxed line by line: sub-categories, supplier details,
 * the tax switch on a single part line (work order and counter sale), and
 * changing who a counter sale is for once it has started.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let exemptRate: string;
let exemptCustomer: string;
let plainCustomer: string;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const newOrder = async () => {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_work_order(${shop.customerId}, ${shop.vehicleId}, NULL, NULL) AS id`);
  return r.id as string;
};
const orderOf = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.work_orders WHERE id = ${id}`)[0];

/** A $100 part on a new order, returning order and line ids. BP-1234 sells at $100. */
const orderWithPart = async (qty = 1) => {
  const id = await newOrder();
  await as("parts_advisor", (tx) => tx`
    SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, ${qty}, ${shop.users.parts_advisor})`);
  const [line] = await owner()<Row[]>`SELECT id FROM grip.work_order_part_lines WHERE work_order_id = ${id}`;
  return { id, line: line.id as string };
};

const newSale = async (customerId: string | null = null, name: string | null = null, s = shop) => {
  const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_counter_sale(${customerId}, ${name}) AS id`, s);
  return r.id as string;
};
const saleOf = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.counter_sales WHERE id = ${id}`)[0];

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("po-shop", "po-other");
  shop = await createShop("po-shop", { "BP-1234": 100 });
  other = await createShop("po-other");

  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
  }
  [{ id: exemptRate }] = await owner()<Row[]>`
    INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts)
    VALUES (${shop.tenantId}, 'Exempt', false, false) RETURNING id`;
  [{ id: exemptCustomer }] = await owner()<Row[]>`
    INSERT INTO grip.customers (tenant_id, display_name, tax_rate_id, exempt_reason, exempt_reference)
    VALUES (${shop.tenantId}, 'Fleet Customer', ${exemptRate}, 'resale', '123456789RT0001') RETURNING id`;
  [{ id: plainCustomer }] = await owner()<Row[]>`
    INSERT INTO grip.customers (tenant_id, display_name) VALUES (${shop.tenantId}, 'Plain Customer') RETURNING id`;
});

afterAll(async () => {
  await dropShops("po-shop", "po-other");
  await closeAll();
});

describe("categories and sub-categories", () => {
  test("a part keeps both, and either can be empty", async () => {
    const [p] = await owner()<Row[]>`
      INSERT INTO grip.parts (tenant_id, sku, description, category, subcategory, unit_cost, unit_price)
      VALUES (${shop.tenantId}, 'CAT-1', 'Pad set', 'Brakes', 'Pads', 10, 20) RETURNING *`;
    expect(p.category).toBe("Brakes");
    expect(p.subcategory).toBe("Pads");

    const [q] = await owner()<Row[]>`
      INSERT INTO grip.parts (tenant_id, sku, description, unit_cost, unit_price)
      VALUES (${shop.tenantId}, 'CAT-2', 'Loose part', 10, 20) RETURNING *`;
    expect(q.category).toBeNull();
    expect(q.subcategory).toBeNull();
  });

  test("the same sub-category name can sit under two categories", async () => {
    await owner()`
      INSERT INTO grip.parts (tenant_id, sku, description, category, subcategory, unit_cost, unit_price)
      VALUES (${shop.tenantId}, 'CAT-3', 'Filter', 'Engine', 'Filters', 1, 2),
             (${shop.tenantId}, 'CAT-4', 'Filter', 'Cabin', 'Filters', 1, 2)`;
    const rows = await owner()<Row[]>`
      SELECT category FROM grip.parts WHERE tenant_id = ${shop.tenantId} AND subcategory = 'Filters' ORDER BY category`;
    expect(rows.map((r) => r.category)).toEqual(["Cabin", "Engine"]);
  });
});

describe("suppliers carry an address, hours and delivery details", () => {
  test("all of it is stored per supplier", async () => {
    const [s] = await owner()<Row[]>`
      INSERT INTO grip.suppliers
        (tenant_id, name, address_line1, city, region, postal_code, hours, delivery_notes, lead_time_days)
      VALUES (${shop.tenantId}, 'Parts Plus', '12 Industrial Pkwy', 'Mississauga', 'ON', 'L5T 1A1',
              'Mon-Fri 7:30-5, Sat 8-12', 'Same day if ordered before 10 a.m.', 1)
      RETURNING *`;
    expect(s).toMatchObject({
      address_line1: "12 Industrial Pkwy", city: "Mississauga", postal_code: "L5T 1A1",
      hours: "Mon-Fri 7:30-5, Sat 8-12", delivery_notes: "Same day if ordered before 10 a.m.",
      lead_time_days: 1,
    });
  });

  test("another shop cannot see it", async () => {
    const rows = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT name FROM grip.suppliers WHERE hours IS NOT NULL`, other);
    expect(rows).toHaveLength(0);
  });
});

describe("tax on a single part line, on a work order", () => {
  test("switching it off removes the tax on that line only", async () => {
    const { id, line } = await orderWithPart(1);        // $100 part, $13 HST
    expect(Number((await orderOf(id)).tax_total)).toBe(13);

    await as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, false)`);
    expect(Number((await orderOf(id)).tax_total)).toBe(0);
    expect(Number((await orderOf(id)).total)).toBe(100);

    await as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, true)`);
    expect(Number((await orderOf(id)).tax_total)).toBe(13);
  });

  test("other lines on the same order are untouched", async () => {
    const { id, line } = await orderWithPart(1);
    await as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Fit', 1, NULL, 100)`);
    expect(Number((await orderOf(id)).tax_total)).toBe(26);          // $200 taxable
    await as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, false)`);
    expect(Number((await orderOf(id)).tax_total)).toBe(13);          // only the labour is taxed
  });

  test("records who changed it, so the page can say Edited by", async () => {
    const { line } = await orderWithPart();
    await as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, false)`);
    const [row] = await owner()<Row[]>`SELECT edited_by_user_id, edited_at FROM grip.work_order_part_lines WHERE id = ${line}`;
    expect(row.edited_by_user_id).toBe(shop.users.parts_advisor);
    expect(row.edited_at).not.toBeNull();
  });

  test("an unchanged value is a no-op with nothing recorded", async () => {
    const { id, line } = await orderWithPart();
    await as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, true)`);
    const [row] = await owner()<Row[]>`SELECT edited_by_user_id FROM grip.work_order_part_lines WHERE id = ${line}`;
    expect(row.edited_by_user_id).toBeNull();
    const trail = await owner()<Row[]>`SELECT 1 FROM grip.audit_log WHERE entity_id = ${id} AND action = 'part.tax_changed'`;
    expect(trail).toHaveLength(0);
  });

  test("closes when the job is completed, like the part itself", async () => {
    const { id, line } = await orderWithPart();
    for (const to of ["approved", "in_progress", "completed"]) {
      await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, ${to}::grip.work_order_status)`);
    }
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, false)`))
      .rejects.toThrow(/cannot change lines/i);
  });

  test("another shop's line cannot be touched", async () => {
    const { line } = await orderWithPart();
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.set_part_line_taxable(${line}, false)`, other))
      .rejects.toThrow(/part line not found/i);
  });
});

describe("tax on a single part line, on a counter sale", () => {
  const withPart = async () => {
    const id = await newSale();
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    const [line] = await owner()<Row[]>`SELECT id FROM grip.counter_sale_lines WHERE counter_sale_id = ${id}`;
    return { id, line: line.id as string };
  };

  test("off and back on, with the total following", async () => {
    const { id, line } = await withPart();
    expect(Number((await saleOf(id)).tax_total)).toBe(13);
    await as("parts_advisor", (tx) => tx`SELECT grip.set_counter_sale_line_taxable(${line}, false)`);
    expect(Number((await saleOf(id)).tax_total)).toBe(0);
    await as("parts_advisor", (tx) => tx`SELECT grip.set_counter_sale_line_taxable(${line}, true)`);
    expect(Number((await saleOf(id)).tax_total)).toBe(13);
  });

  test("locked once the sale is completed", async () => {
    const { id, line } = await withPart();
    await as("parts_advisor", (tx) => tx`SELECT grip.complete_counter_sale(${id})`);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.set_counter_sale_line_taxable(${line}, false)`))
      .rejects.toThrow(/completed cannot be changed/i);
  });
});

describe("changing a counter sale's customer", () => {
  const change = (id: string, customer: string | null, name: string | null = null, s = shop) =>
    as("parts_advisor", (tx) => tx`SELECT grip.set_counter_sale_customer(${id}, ${customer}, ${name})`, s);

  test("a walk-in becomes a customer on file, taking their name", async () => {
    const id = await newSale();
    await change(id, plainCustomer);
    const sale = await saleOf(id);
    expect(sale.customer_id).toBe(plainCustomer);
    expect(sale.customer_name).toBe("Plain Customer");
  });

  test("an exempt customer's sale is exempt, with their reason", async () => {
    const id = await newSale();
    await change(id, exemptCustomer);
    const sale = await saleOf(id);
    expect(sale.tax_rate_id).toBe(exemptRate);
    expect(sale.exempt_reason).toBe("resale");
    expect(sale.exempt_reference).toBe("123456789RT0001");
  });

  test("moving back to a walk-in returns to the shop's normal rate and drops the reason", async () => {
    const id = await newSale();
    await change(id, exemptCustomer);
    await change(id, null, "Dave at the counter");
    const sale = await saleOf(id);
    expect(sale.customer_id).toBeNull();
    expect(sale.customer_name).toBe("Dave at the counter");
    expect(sale.tax_rate_id).toBe(shop.taxRateId);
    expect(sale.exempt_reason).toBeNull();
  });

  test("a blank name falls back to Walk-in", async () => {
    const id = await newSale(null, "Someone");
    await change(id, null, "   ");
    expect((await saleOf(id)).customer_name).toBe("Walk-in");
  });

  test("totals are re-priced at the new customer's rate", async () => {
    const id = await newSale();
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    expect(Number((await saleOf(id)).tax_total)).toBe(13);
    await change(id, exemptCustomer);
    expect(Number((await saleOf(id)).tax_total)).toBe(0);
  });

  test("locked once the sale is completed", async () => {
    const id = await newSale();
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    await as("parts_advisor", (tx) => tx`SELECT grip.complete_counter_sale(${id})`);
    await expect(change(id, plainCustomer)).rejects.toThrow(/completed cannot be changed/i);
  });

  test("cannot be given to another shop's customer", async () => {
    const id = await newSale();
    await expect(change(id, other.customerId)).rejects.toThrow(/customer not found/i);
  });

  test("the change is written to the activity trail", async () => {
    const id = await newSale();
    await change(id, plainCustomer);
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE entity_id = ${id} AND action = 'counter_sale.customer_changed'`;
    expect(row.actor_user_id).toBe(shop.users.parts_advisor);
    expect(row.diff.customer).toBe("Plain Customer");
  });
});
