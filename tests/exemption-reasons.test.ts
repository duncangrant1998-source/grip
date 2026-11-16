/**
 * Why a document carries no HST.
 *
 * Charging no tax is a claim the shop has to be able to back up years later, so
 * an exemption carries a reason and, where one exists, a number. These cover
 * the rule that no unexplained exempt invoice can be issued, the snapshot onto
 * the document, and what happens when a status card lapses.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let exemptId: string;
let otherExemptId: string;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const get = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.work_orders WHERE id = ${id}`)[0];

/** A customer with a standing exemption. `expires` is a YYYY-MM-DD or null. */
async function exemptCustomer(
  name: string,
  reason: string,
  reference: string | null,
  expires: string | null = null,
  s: Shop = shop,
  rateId = exemptId,
) {
  const [c] = await owner()<Row[]>`
    INSERT INTO grip.customers
      (tenant_id, display_name, tax_rate_id, exempt_reason, exempt_reference, exempt_expires_on)
    VALUES (${s.tenantId}, ${name}, ${rateId}, ${reason}::grip.exempt_reason,
            ${reference}, ${expires}::date)
    RETURNING id`;
  const [v] = await owner()<Row[]>`
    INSERT INTO grip.vehicles (tenant_id, customer_id, make, model)
    VALUES (${s.tenantId}, ${c.id}, 'Ford', 'F-150') RETURNING id`;
  return { customerId: c.id as string, vehicleId: v.id as string };
}

const newOrder = async (customerId = shop.customerId, vehicleId = shop.vehicleId, s = shop) => {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_work_order(${customerId}, ${vehicleId}, NULL, NULL) AS id`, s);
  return r.id as string;
};

const addWork = (id: string) =>
  as("service_advisor", (tx) => tx`SELECT grip.add_labour_line(${id}, 'Brake job', 2, NULL, 100)`);

const setExempt = (id: string, reason: string | null, reference: string | null = null) =>
  as("service_advisor", (tx) => tx`
    SELECT grip.set_work_order_exemption(${id}, ${reason}::grip.exempt_reason, ${reference})`);

/** Walks the order forward to `last`, picking up from wherever it already is. */
const advanceTo = async (id: string, last: string) => {
  const steps = ["quote", "approved", "in_progress", "completed", "invoiced"];
  const from = steps.indexOf((await get(id)).status);
  for (const to of steps.slice(from + 1, steps.indexOf(last) + 1)) {
    await as("service_advisor", (tx) => tx`
      SELECT grip.transition_work_order(${id}, ${to}::grip.work_order_status)`);
  }
};

/** The day after tomorrow / the day before yesterday, in the shop's timezone. */
const shopDay = async (offset: number) => {
  const [row] = await owner()<Row[]>`
    SELECT to_char(((now() AT TIME ZONE 'America/Toronto')::date + ${offset}::int), 'YYYY-MM-DD') AS d`;
  return row.d as string;
};

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("ex-shop", "ex-other");
  shop = await createShop("ex-shop", { "BP-1234": 20 });
  other = await createShop("ex-other", { "BP-1234": 20 });

  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
  }
  [{ id: exemptId }] = await owner()<{ id: string }[]>`
    INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts)
    VALUES (${shop.tenantId}, 'Exempt', false, false) RETURNING id`;
  [{ id: otherExemptId }] = await owner()<{ id: string }[]>`
    INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts)
    VALUES (${other.tenantId}, 'Exempt', false, false) RETURNING id`;
});

afterAll(async () => {
  await dropShops("ex-shop", "ex-other");
  await closeAll();
});

describe("what counts as exempt", () => {
  test("the Exempt rate is, and HST is not", async () => {
    const [row] = await as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.rate_is_exempt(${exemptId}) AS ex, grip.rate_is_exempt(${shop.taxRateId}) AS hst`);
    expect(row.ex).toBe(true);
    expect(row.hst).toBe(false);
  });

  test("no rate at all is exempt", async () => {
    const [row] = await as("shop_admin", (tx) => tx<Row[]>`SELECT grip.rate_is_exempt(NULL) AS ex`);
    expect(row.ex).toBe(true);
  });

  test("HST set to 0% is NOT exempt — an unregistered shop owes no explanation", async () => {
    await as("shop_admin", (tx) => tx`SELECT grip.set_hst_rate(0)`);
    const [row] = await as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.rate_is_exempt(${shop.taxRateId}) AS ex`);
    expect(row.ex).toBe(false);

    // And such an order invoices without a reason.
    const id = await newOrder();
    await addWork(id);
    await advanceTo(id, "invoiced");
    expect((await get(id)).status).toBe("invoiced");
    await as("shop_admin", (tx) => tx`SELECT grip.set_hst_rate(1300)`);
  });
});

describe("no unexplained exempt invoice leaves the building", () => {
  test("invoicing is refused while the reason is missing", async () => {
    const id = await newOrder();
    await addWork(id);
    await setExempt(id, null);
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await advanceTo(id, "completed");

    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.transition_work_order(${id}, 'invoiced')`)).rejects.toThrow(/record why it is exempt/i);
    expect((await get(id)).status).toBe("completed");
  });

  test("and goes through once it is recorded", async () => {
    const id = await newOrder();
    await addWork(id);
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await setExempt(id, "status_card", "1234567890");
    await advanceTo(id, "invoiced");

    const wo = await get(id);
    expect(wo.status).toBe("invoiced");
    expect(wo.exempt_reason).toBe("status_card");
    expect(wo.exempt_reference).toBe("1234567890");
    expect(Number(wo.tax_total)).toBe(0);
  });

  test("a taxed invoice needs no reason", async () => {
    const id = await newOrder();
    await addWork(id);
    await advanceTo(id, "invoiced");
    const wo = await get(id);
    expect(wo.status).toBe("invoiced");
    expect(wo.exempt_reason).toBeNull();
    expect(Number(wo.tax_total)).toBe(26);
  });

  test("a counter sale is held to the same rule", async () => {
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_counter_sale(NULL, 'Walk-in') AS id`);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${r.id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    await as("parts_advisor", (tx) => tx`SELECT grip.set_counter_sale_tax(${r.id}, ${exemptId})`);

    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.complete_counter_sale(${r.id})`)).rejects.toThrow(/record why it is exempt/i);

    await as("parts_advisor", (tx) => tx`
      SELECT grip.set_counter_sale_exemption(${r.id}, 'resale'::grip.exempt_reason, '123456789RT0001')`);
    await as("parts_advisor", (tx) => tx`SELECT grip.complete_counter_sale(${r.id})`);

    const [sale] = await owner()<Row[]>`SELECT * FROM grip.counter_sales WHERE id = ${r.id}`;
    expect(sale.status).toBe("completed");
    expect(sale.exempt_reason).toBe("resale");
  });
});

describe("the number that goes with the reason", () => {
  test.each(["status_card", "government", "resale"])("%s needs one", async (reason) => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await expect(setExempt(id, reason)).rejects.toThrow(/card, account or HST number/i);
  });

  test.each(["export", "internal", "other"])("%s does not", async (reason) => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await setExempt(id, reason);
    expect((await get(id)).exempt_reason).toBe(reason);
  });

  test("a blank reference counts as missing", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await expect(setExempt(id, "status_card", "   ")).rejects.toThrow(/card, account or HST number/i);
  });
});

describe("keeping the reason and the rate in step", () => {
  test("a reason can't be put on a taxed order", async () => {
    const id = await newOrder();
    await expect(setExempt(id, "other")).rejects.toThrow(/being taxed/i);
  });

  test("switching back to HST drops the reason", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await setExempt(id, "internal", null);
    expect((await get(id)).exempt_reason).toBe("internal");

    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${shop.taxRateId})`);
    const wo = await get(id);
    expect(wo.exempt_reason).toBeNull();
    expect(wo.exempt_reference).toBeNull();
  });

  test("the reason is frozen with the invoice", async () => {
    const id = await newOrder();
    await addWork(id);
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await setExempt(id, "government", "GOV-99");
    await advanceTo(id, "invoiced");

    await expect(setExempt(id, "other")).rejects.toThrow();
    expect((await get(id)).exempt_reason).toBe("government");
  });

  test("the change is written to the activity trail", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await setExempt(id, "resale", "999888777RT0001");

    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE entity_id = ${id} AND action = 'work_order.exemption_set'`;
    expect(row.actor_user_id).toBe(shop.users.service_advisor);
    expect(row.diff).toMatchObject({ reason: "resale", reference: "999888777RT0001" });
  });
});

describe("a customer's standing exemption", () => {
  test("carries onto a new work order, reason and number together", async () => {
    const c = await exemptCustomer("Grand River Fleet", "status_card", "555000111");
    const wo = await get(await newOrder(c.customerId, c.vehicleId));
    expect(wo.tax_rate_id).toBe(exemptId);
    expect(wo.exempt_reason).toBe("status_card");
    expect(wo.exempt_reference).toBe("555000111");
  });

  test("and onto a counter sale", async () => {
    const c = await exemptCustomer("Wholesale Partners", "resale", "111222333RT0001");
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_counter_sale(${c.customerId}, NULL) AS id`);
    const [sale] = await owner()<Row[]>`SELECT * FROM grip.counter_sales WHERE id = ${r.id}`;
    expect(sale.tax_rate_id).toBe(exemptId);
    expect(sale.exempt_reason).toBe("resale");
  });

  test("an expiry still in the future is honoured", async () => {
    const c = await exemptCustomer("Future Card", "status_card", "777", await shopDay(30));
    const wo = await get(await newOrder(c.customerId, c.vehicleId));
    expect(wo.tax_rate_id).toBe(exemptId);
    expect(wo.exempt_reason).toBe("status_card");
  });

  test("expiring today still counts — the card is good until the day is out", async () => {
    const c = await exemptCustomer("Today Card", "status_card", "778", await shopDay(0));
    const wo = await get(await newOrder(c.customerId, c.vehicleId));
    expect(wo.exempt_reason).toBe("status_card");
  });

  test("a lapsed card leaves the order exempt but unexplained", async () => {
    const c = await exemptCustomer("Lapsed Card", "status_card", "779", await shopDay(-1));
    const id = await newOrder(c.customerId, c.vehicleId);
    await addWork(id);

    const wo = await get(id);
    // The shop marked them exempt, so the rate stands; the stale card does not.
    expect(wo.tax_rate_id).toBe(exemptId);
    expect(wo.exempt_reason).toBeNull();
    expect(Number(wo.tax_total)).toBe(0);
  });

  test("and that order cannot be invoiced until the renewal is recorded", async () => {
    const c = await exemptCustomer("Renewal Needed", "status_card", "780", await shopDay(-2));
    const id = await newOrder(c.customerId, c.vehicleId);
    await addWork(id);
    await advanceTo(id, "completed");

    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.transition_work_order(${id}, 'invoiced')`)).rejects.toThrow(/record why it is exempt/i);

    await setExempt(id, "status_card", "780-renewed");
    await advanceTo(id, "invoiced");
    expect((await get(id)).status).toBe("invoiced");
  });

  test("a lapsed card on a counter sale leaves it unexplained too", async () => {
    const c = await exemptCustomer("Lapsed Counter", "government", "GOV-1", await shopDay(-5));
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_counter_sale(${c.customerId}, NULL) AS id`);
    const [sale] = await owner()<Row[]>`SELECT * FROM grip.counter_sales WHERE id = ${r.id}`;
    expect(sale.tax_rate_id).toBe(exemptId);
    expect(sale.exempt_reason).toBeNull();
  });

  test("an exempt customer with no reason on file stays exempt, and is stopped at invoicing", async () => {
    // The shape left by data from before reasons existed.
    const [c] = await owner()<Row[]>`
      INSERT INTO grip.customers (tenant_id, display_name, tax_rate_id)
      VALUES (${shop.tenantId}, 'Legacy Exempt', ${exemptId}) RETURNING id`;
    const [v] = await owner()<Row[]>`
      INSERT INTO grip.vehicles (tenant_id, customer_id, make, model)
      VALUES (${shop.tenantId}, ${c.id}, 'Ram', '1500') RETURNING id`;

    const id = await newOrder(c.id, v.id);
    await addWork(id);
    expect((await get(id)).tax_rate_id).toBe(exemptId);
    expect(Number((await get(id)).tax_total)).toBe(0);

    await advanceTo(id, "completed");
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.transition_work_order(${id}, 'invoiced')`)).rejects.toThrow(/record why it is exempt/i);
  });

  test("the reason can be recorded on a completed order, right before invoicing", async () => {
    const id = await newOrder();
    await addWork(id);
    await as("service_advisor", (tx) => tx`SELECT grip.set_work_order_tax(${id}, ${exemptId})`);
    await advanceTo(id, "completed");

    await setExempt(id, "internal", null);
    await advanceTo(id, "invoiced");
    expect((await get(id)).status).toBe("invoiced");
  });
});

describe("the customer record itself", () => {
  test("refuses a status card with no number", async () => {
    await expect(owner()`
      INSERT INTO grip.customers (tenant_id, display_name, exempt_reason)
      VALUES (${shop.tenantId}, 'No Number', 'status_card')`).rejects.toThrow();
  });

  test("allows 'other' with no number", async () => {
    const [c] = await owner()<Row[]>`
      INSERT INTO grip.customers (tenant_id, display_name, exempt_reason)
      VALUES (${shop.tenantId}, 'Other Reason', 'other') RETURNING id`;
    expect(c.id).toBeTruthy();
  });
});

describe("tenant isolation", () => {
  test("a shop cannot set an exemption on another shop's order", async () => {
    const [r] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_work_order(${other.customerId}, ${other.vehicleId}, NULL, NULL) AS id`, other);
    await as("service_advisor", (tx) => tx`
      SELECT grip.set_work_order_tax(${r.id}, ${otherExemptId})`, other);

    await expect(setExempt(r.id, "other")).rejects.toThrow(/work order not found/i);
    const [wo] = await owner()<Row[]>`SELECT exempt_reason FROM grip.work_orders WHERE id = ${r.id}`;
    expect(wo.exempt_reason).toBeNull();
  });

  test("one shop's exempt customers are invisible to the other", async () => {
    await exemptCustomer("Shared Name Fleet", "status_card", "AAA111");
    const theirs = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT exempt_reference FROM grip.customers WHERE exempt_reference IS NOT NULL`, other);
    expect(theirs.every((r) => r.exempt_reference !== "AAA111")).toBe(true);
  });
});
