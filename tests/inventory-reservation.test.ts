/**
 * The inventory reservation engine.
 *
 *   available = qty_on_hand - qty_reserved
 *
 * Allocating a part to a job promises it without moving it off the shelf;
 * completing the job is what actually consumes it. The case that matters most
 * is two advisors reaching for the last alternator at the same moment.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  app, appAlt, owner, asTenant, assertAppRoleIsRestricted,
  createShop, createWorkOrder, stockOf, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("inv-shop");
  shop = await createShop("inv-shop", { "BP-1234": 10, "ALT-7781": 1 });
});

afterAll(async () => {
  await dropShops("inv-shop");
  await closeAll();
});

beforeEach(async () => {
  // Reset stock and clear documents between tests.
  await owner()`DELETE FROM grip.work_orders WHERE tenant_id = ${shop.tenantId}`;
  await owner()`DELETE FROM grip.counter_sales WHERE tenant_id = ${shop.tenantId}`;
  await owner()`
    UPDATE grip.part_stock SET qty_reserved = 0, qty_on_hand = 10
    WHERE part_id = ${shop.parts["BP-1234"]}`;
  await owner()`
    UPDATE grip.part_stock SET qty_reserved = 0, qty_on_hand = 1
    WHERE part_id = ${shop.parts["ALT-7781"]}`;
});

const as = <T>(userKey: string, fn: Parameters<typeof asTenant<T>>[2]) =>
  asTenant(app(), { tenantId: shop.tenantId, userId: shop.users[userKey] }, fn);

describe("reserving", () => {
  test("allocating a part reserves it without taking it off the shelf", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["BP-1234"]}, 3, ${shop.users.parts_advisor})`);

    const s = await stockOf(shop.parts["BP-1234"]);
    expect(s.onHand).toBe(10);   // still physically there
    expect(s.reserved).toBe(3);
    expect(s.available).toBe(7); // but promised
  });

  test("reserving writes a ledger entry naming who did it", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["BP-1234"]}, 2, ${shop.users.parts_advisor})`);

    const [m] = await owner()<{ kind: string; delta: number; user_id: string }[]>`
      SELECT kind, delta, user_id FROM grip.stock_movements
      WHERE tenant_id = ${shop.tenantId} AND part_id = ${shop.parts["BP-1234"]}
      ORDER BY id DESC LIMIT 1`;
    expect(m.kind).toBe("reserve");
    expect(m.delta).toBe(2);
    expect(m.user_id).toBe(shop.users.parts_advisor);
  });

  test("a quote reserves stock too, not just an active job", async () => {
    const quote = await createWorkOrder(shop, "quote");
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${quote}, ${shop.parts["BP-1234"]}, 4, ${shop.users.parts_advisor})`);

    expect((await stockOf(shop.parts["BP-1234"])).available).toBe(6);
  });

  test("over-allocating is refused when backorder is not allowed", async () => {
    const wo = await createWorkOrder(shop);
    await expect(
      as("parts_advisor", (tx) => tx`
        SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["ALT-7781"]}, 2, ${shop.users.parts_advisor})`),
    ).rejects.toThrow(/insufficient stock/i);

    const s = await stockOf(shop.parts["ALT-7781"]);
    expect(s.reserved).toBe(0); // nothing half-reserved
  });

  test("backorder reserves what exists and records the shortfall", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(
        ${wo}, ${shop.parts["ALT-7781"]}, 3, ${shop.users.parts_advisor}, true)`);

    const s = await stockOf(shop.parts["ALT-7781"]);
    expect(s.reserved).toBe(1);

    const [line] = await owner()<{ qty: number; qty_reserved: number; qty_backordered: number }[]>`
      SELECT qty, qty_reserved, qty_backordered FROM grip.work_order_part_lines
      WHERE work_order_id = ${wo}`;
    expect(line.qty).toBe(3);
    expect(line.qty_reserved).toBe(1);
    expect(line.qty_backordered).toBe(2);
  });

  test("cannot add parts to an invoiced order", async () => {
    const wo = await createWorkOrder(shop, "invoiced");
    await expect(
      as("parts_advisor", (tx) => tx`
        SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`),
    ).rejects.toThrow(/cannot add parts to a work order that is invoiced/i);
  });
});

describe("releasing", () => {
  test("removing a line gives the stock back", async () => {
    const wo = await createWorkOrder(shop);
    const [{ add_part_to_work_order: lineId }] = await as<{ add_part_to_work_order: string }[]>(
      "parts_advisor",
      (tx) => tx`SELECT grip.add_part_to_work_order(
        ${wo}, ${shop.parts["BP-1234"]}, 3, ${shop.users.parts_advisor})`,
    );
    expect((await stockOf(shop.parts["BP-1234"])).available).toBe(7);

    await as("parts_advisor", (tx) => tx`
      SELECT grip.remove_part_from_work_order(${lineId}, ${shop.users.parts_advisor})`);

    const s = await stockOf(shop.parts["BP-1234"]);
    expect(s.reserved).toBe(0);
    expect(s.available).toBe(10);
  });

  test("cancelling the job releases everything on it", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["BP-1234"]}, 5, ${shop.users.parts_advisor})`);
    await as("shop_admin", (tx) => tx`
      SELECT grip.cancel_work_order(${wo}, ${shop.users.shop_admin})`);

    expect((await stockOf(shop.parts["BP-1234"])).available).toBe(10);
  });
});

describe("consuming", () => {
  test("completing the job takes the stock off the shelf", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["BP-1234"]}, 3, ${shop.users.parts_advisor})`);
    await as("technician", (tx) => tx`
      SELECT grip.complete_work_order(${wo}, ${shop.users.technician})`);

    const s = await stockOf(shop.parts["BP-1234"]);
    expect(s.onHand).toBe(7);    // gone from the shelf
    expect(s.reserved).toBe(0);  // no longer merely promised
    expect(s.available).toBe(7);

    const [line] = await owner()<{ qty_consumed: number; qty_reserved: number }[]>`
      SELECT qty_consumed, qty_reserved FROM grip.work_order_part_lines
      WHERE work_order_id = ${wo}`;
    expect(line.qty_consumed).toBe(3);
    expect(line.qty_reserved).toBe(0);
  });

  test("a consumed line cannot be removed", async () => {
    const wo = await createWorkOrder(shop);
    const [{ add_part_to_work_order: lineId }] = await as<{ add_part_to_work_order: string }[]>(
      "parts_advisor",
      (tx) => tx`SELECT grip.add_part_to_work_order(
        ${wo}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`,
    );
    await as("technician", (tx) => tx`
      SELECT grip.complete_work_order(${wo}, ${shop.users.technician})`);

    await expect(
      as("parts_advisor", (tx) => tx`
        SELECT grip.remove_part_from_work_order(${lineId}, ${shop.users.parts_advisor})`),
    ).rejects.toThrow(/already been consumed/i);
  });
});

describe("the counter competes for the same shelf", () => {
  test("a counter sale cannot take stock reserved for a job", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["ALT-7781"]}, 1, ${shop.users.parts_advisor})`);

    const sale = await createCounterSale();
    await expect(
      as("parts_advisor", (tx) => tx`
        SELECT grip.add_part_to_counter_sale(${sale}, ${shop.parts["ALT-7781"]}, 1, ${shop.users.parts_advisor})`),
    ).rejects.toThrow(/insufficient stock/i);
  });

  test("a counter sale takes stock immediately, with no reservation step", async () => {
    const sale = await createCounterSale();
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${sale}, ${shop.parts["BP-1234"]}, 2, ${shop.users.parts_advisor})`);

    const s = await stockOf(shop.parts["BP-1234"]);
    expect(s.onHand).toBe(8);
    expect(s.reserved).toBe(0);
  });
});

describe("two advisors, one alternator", () => {
  test("concurrent allocation of the last part: exactly one wins", async () => {
    const woA = await createWorkOrder(shop);
    const woB = await createWorkOrder(shop);

    const altConn = appAlt();
    const part = shop.parts["ALT-7781"];

    try {
      // Both transactions open, then both reach for the same row. The
      // FOR UPDATE lock in add_part_to_work_order serialises them; the loser
      // re-reads availability as 0 and is refused.
      const attempt = (sql: typeof altConn, wo: string) =>
        asTenant(sql, { tenantId: shop.tenantId, userId: shop.users.parts_advisor }, async (tx) => {
          await tx`SELECT pg_sleep(0.05)`;
          return tx`SELECT grip.add_part_to_work_order(
            ${wo}, ${part}, 1, ${shop.users.parts_advisor})`;
        });

      const results = await Promise.allSettled([
        attempt(app(), woA),
        attempt(altConn, woB),
      ]);

      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason.message).toMatch(/insufficient stock/i);

      // The decisive assertion: reserved never exceeded what exists.
      const s = await stockOf(part);
      expect(s.reserved).toBe(1);
      expect(s.available).toBe(0);
    } finally {
      await altConn.end();
    }
  });

  test("reserved never exceeds on-hand under a burst of allocations", async () => {
    // 10 on hand, 8 concurrent single-unit allocations: all should succeed,
    // and reserved must land on exactly 8.
    const orders = await Promise.all(Array.from({ length: 8 }, () => createWorkOrder(shop)));
    const conns = Array.from({ length: 8 }, () => appAlt());

    try {
      const results = await Promise.allSettled(
        orders.map((wo, i) =>
          asTenant(conns[i], { tenantId: shop.tenantId, userId: shop.users.parts_advisor }, (tx) =>
            tx`SELECT grip.add_part_to_work_order(
              ${wo}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(8);

      const s = await stockOf(shop.parts["BP-1234"]);
      expect(s.reserved).toBe(8);
      expect(s.available).toBe(2);
      expect(s.reserved).toBeLessThanOrEqual(s.onHand);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });
});

describe("totals and tax", () => {
  test("tax is calculated per component and stored on the document", async () => {
    const wo = await createWorkOrder(shop);

    await owner()`
      INSERT INTO grip.work_order_labour_lines
        (tenant_id, work_order_id, description, billed_hours, actual_hours, rate, added_by_user_id)
      VALUES (${shop.tenantId}, ${wo}, 'Diagnose', 2.00, 1.50, 100.00, ${shop.users.service_advisor})`;
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${shop.parts["BP-1234"]}, 1, ${shop.users.parts_advisor})`);
    await as("service_advisor", (tx) => tx`SELECT grip.recalculate_work_order(${wo})`);

    const [totals] = await owner()<
      { labour_subtotal: string; parts_subtotal: string; subtotal: string; tax_total: string; total: string }[]
    >`SELECT labour_subtotal, parts_subtotal, subtotal, tax_total, total
      FROM grip.work_orders WHERE id = ${wo}`;

    // 2.00 h x $100 labour + 1 x $100 part = $300 subtotal
    expect(Number(totals.labour_subtotal)).toBe(200);
    expect(Number(totals.parts_subtotal)).toBe(100);
    expect(Number(totals.subtotal)).toBe(300);
    // HST 13% of $300 = $39.00
    expect(Number(totals.tax_total)).toBe(39);
    expect(Number(totals.total)).toBe(339);

    const components = await owner()<{ component_name: string; amount: string }[]>`
      SELECT component_name, amount FROM grip.work_order_taxes
      WHERE work_order_id = ${wo} ORDER BY sort_order`;
    expect(components.map((c) => [c.component_name, Number(c.amount)]))
      .toEqual([["HST", 39]]);
  });

  test("a non-taxable line is excluded from the taxable base", async () => {
    const wo = await createWorkOrder(shop);
    await owner()`
      INSERT INTO grip.work_order_labour_lines
        (tenant_id, work_order_id, description, billed_hours, rate, is_taxable, added_by_user_id)
      VALUES (${shop.tenantId}, ${wo}, 'Warranty rework', 1.00, 100.00, false,
              ${shop.users.service_advisor})`;
    await as("service_advisor", (tx) => tx`SELECT grip.recalculate_work_order(${wo})`);

    const [t] = await owner()<{ subtotal: string; tax_total: string }[]>`
      SELECT subtotal, tax_total FROM grip.work_orders WHERE id = ${wo}`;
    expect(Number(t.subtotal)).toBe(100);
    expect(Number(t.tax_total)).toBe(0);
  });

  test("billing uses billed hours, so flat rate and straight time both reconcile", async () => {
    const wo = await createWorkOrder(shop);
    // Book time 2.4 h, actual 2.1 h — the shop bills the book time.
    await owner()`
      INSERT INTO grip.work_order_labour_lines
        (tenant_id, work_order_id, description, billed_hours, actual_hours, rate,
         billing_mode, added_by_user_id)
      VALUES (${shop.tenantId}, ${wo}, 'Brakes', 2.40, 2.10, 100.00, 'flat_rate',
              ${shop.users.service_advisor})`;
    await as("service_advisor", (tx) => tx`SELECT grip.recalculate_work_order(${wo})`);

    const [t] = await owner()<{ labour_subtotal: string }[]>`
      SELECT labour_subtotal FROM grip.work_orders WHERE id = ${wo}`;
    expect(Number(t.labour_subtotal)).toBe(240);

    // Efficiency reads off the same two columns in either mode.
    const [e] = await owner()<{ efficiency: string }[]>`
      SELECT round(sum(billed_hours) / nullif(sum(actual_hours), 0), 4) AS efficiency
      FROM grip.work_order_labour_lines WHERE work_order_id = ${wo}`;
    expect(Number(e.efficiency)).toBeCloseTo(2.4 / 2.1, 3);
  });
});

async function createCounterSale(): Promise<string> {
  const [{ n }] = await owner()<{ n: number }[]>`
    SELECT coalesce(max(number), 1000) + 1 AS n
    FROM grip.counter_sales WHERE tenant_id = ${shop.tenantId}`;
  const [sale] = await owner()<{ id: string }[]>`
    INSERT INTO grip.counter_sales (tenant_id, number, customer_name, tax_rate_id, sold_by)
    VALUES (${shop.tenantId}, ${n}, 'Walk-in', ${shop.taxRateId}, ${shop.users.parts_advisor})
    RETURNING id`;
  return sale.id;
}
