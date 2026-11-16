/**
 * The parts side: purchase orders, receiving, backorder fill, cycle counts,
 * reorder suggestions and the counter-sale lifecycle.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, createWorkOrder, stockOf, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let supplierId: string;
let otherSupplierId: string;

type Row = Record<string, any>;
const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const part = (sku: string) => shop.parts[sku];

async function onOrder(partId: string) {
  const [r] = await owner()<Row[]>`SELECT qty_on_order FROM grip.part_stock WHERE part_id = ${partId}`;
  return r.qty_on_order as number;
}
async function cost(partId: string) {
  const [r] = await owner()<Row[]>`SELECT unit_cost FROM grip.parts WHERE id = ${partId}`;
  return Number(r.unit_cost);
}
async function poStatus(id: string) {
  const [r] = await owner()<Row[]>`SELECT status FROM grip.purchase_orders WHERE id = ${id}`;
  return r.status as string;
}

async function newPo() {
  const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_purchase_order(${supplierId}) AS id`);
  return r.id as string;
}
async function addLine(po: string, sku: string, qty: number, unitCost: number | null = null) {
  const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
    SELECT grip.add_purchase_order_line(${po}, ${part(sku)}, ${qty}, ${unitCost}) AS id`);
  return r.id as string;
}
const place = (po: string) =>
  as("parts_advisor", (tx) => tx`SELECT grip.place_purchase_order(${po})`);
const receive = async (lineId: string, qty: number) => {
  const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
    SELECT grip.receive_purchase_order_line(${lineId}, ${qty}, ${shop.users.parts_advisor}) AS filled`);
  return r.filled as number;
};

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("pt-shop", "pt-other");
  shop = await createShop("pt-shop", { "BP-1234": 10, "ALT-7781": 1, "OF-0090": 50 });
  other = await createShop("pt-other");

  const [s] = await owner()<Row[]>`
    INSERT INTO grip.suppliers (tenant_id, name, lead_time_days)
    VALUES (${shop.tenantId}, 'Pacific Parts', 3) RETURNING id`;
  supplierId = s.id;
  const [o] = await owner()<Row[]>`
    INSERT INTO grip.suppliers (tenant_id, name) VALUES (${other.tenantId}, 'Other Supplier') RETURNING id`;
  otherSupplierId = o.id;

  await owner()`INSERT INTO grip.tenant_settings (tenant_id, default_tax_rate_id)
                VALUES (${shop.tenantId}, ${shop.taxRateId})`;
});

afterAll(async () => {
  await dropShops("pt-shop", "pt-other");
  await closeAll();
});

beforeEach(async () => {
  await owner()`DELETE FROM grip.work_orders WHERE tenant_id = ${shop.tenantId}`;
  await owner()`DELETE FROM grip.counter_sales WHERE tenant_id = ${shop.tenantId}`;
  await owner()`DELETE FROM grip.purchase_orders WHERE tenant_id = ${shop.tenantId}`;
  await owner()`UPDATE grip.part_stock SET qty_on_hand = 10, qty_reserved = 0, qty_on_order = 0
                WHERE part_id = ${part("BP-1234")}`;
  await owner()`UPDATE grip.part_stock SET qty_on_hand = 1, qty_reserved = 0, qty_on_order = 0
                WHERE part_id = ${part("ALT-7781")}`;
  await owner()`UPDATE grip.part_stock SET qty_on_hand = 50, qty_reserved = 0, qty_on_order = 0
                WHERE part_id = ${part("OF-0090")}`;
  await owner()`UPDATE grip.parts SET unit_cost = 50.00, supplier_id = NULL, reorder_point = 0, reorder_qty = 0
                WHERE tenant_id = ${shop.tenantId}`;
});

describe("purchase order lifecycle", () => {
  test("a new order is a draft numbered per shop, and stock is untouched", async () => {
    const po = await newPo();
    expect(await poStatus(po)).toBe("draft");
    expect(await onOrder(part("BP-1234"))).toBe(0);
  });

  test("lines total up with the part's cost by default", async () => {
    const po = await newPo();
    await addLine(po, "BP-1234", 4);          // 4 x 50
    await addLine(po, "OF-0090", 10, 6.5);    // 10 x 6.50
    const [t] = await owner()<Row[]>`SELECT subtotal, total FROM grip.purchase_orders WHERE id = ${po}`;
    expect(Number(t.subtotal)).toBe(265);
    expect(Number(t.total)).toBe(265);
  });

  test("adding the same part again increases the quantity instead of duplicating", async () => {
    const po = await newPo();
    await addLine(po, "BP-1234", 4);
    await addLine(po, "BP-1234", 2);
    const lines = await owner()<Row[]>`SELECT qty_ordered FROM grip.purchase_order_lines WHERE purchase_order_id = ${po}`;
    expect(lines).toHaveLength(1);
    expect(lines[0].qty_ordered).toBe(6);
  });

  test("placing the order puts the quantities on order", async () => {
    const po = await newPo();
    await addLine(po, "BP-1234", 8);
    await addLine(po, "ALT-7781", 2);
    await place(po);

    expect(await poStatus(po)).toBe("ordered");
    expect(await onOrder(part("BP-1234"))).toBe(8);
    expect(await onOrder(part("ALT-7781"))).toBe(2);
  });

  test("cannot place an empty order, or place one twice", async () => {
    const po = await newPo();
    await expect(place(po)).rejects.toThrow(/at least one line/i);
    await addLine(po, "BP-1234", 1);
    await place(po);
    await expect(place(po)).rejects.toThrow(/only a draft/i);
  });

  test("lines are locked once the order is placed", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 3);
    await place(po);
    await expect(addLine(po, "OF-0090", 1)).rejects.toThrow(/draft/i);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.remove_purchase_order_line(${line})`))
      .rejects.toThrow(/draft/i);
  });

  test("a tax rate can be selected and is applied to the order total", async () => {
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_purchase_order(${supplierId}, NULL, ${shop.taxRateId}) AS id`);
    await addLine(r.id, "BP-1234", 2); // $100 -> HST 13% = $13
    const [t] = await owner()<Row[]>`SELECT tax_total, total FROM grip.purchase_orders WHERE id = ${r.id}`;
    expect(Number(t.tax_total)).toBe(13);
    expect(Number(t.total)).toBe(113);
  });
});

describe("receiving", () => {
  test("receiving moves stock from on-order to on-hand", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 8);
    await place(po);

    await receive(line, 8);
    const s = await stockOf(part("BP-1234"));
    expect(s.onHand).toBe(18);
    expect(await onOrder(part("BP-1234"))).toBe(0);
    expect(await poStatus(po)).toBe("received");
  });

  test("a partial delivery leaves the order open, then the rest closes it", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 10);
    await place(po);

    await receive(line, 4);
    expect(await poStatus(po)).toBe("partial");
    expect(await onOrder(part("BP-1234"))).toBe(6);

    await receive(line, 6);
    expect(await poStatus(po)).toBe("received");
    expect((await stockOf(part("BP-1234"))).onHand).toBe(20);
  });

  test("cannot receive more than is outstanding", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 3);
    await place(po);
    await expect(receive(line, 4)).rejects.toThrow(/only 3 are outstanding/i);
  });

  test("cannot receive against a draft or a cancelled order", async () => {
    const draft = await newPo();
    const line = await addLine(draft, "BP-1234", 3);
    await expect(receive(line, 1)).rejects.toThrow(/cannot be received against/i);
  });

  test("cost becomes a moving average of what is on hand and what arrived", async () => {
    // 10 on hand @ $50, receive 10 @ $70 -> $60 average.
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 10, 70);
    await place(po);
    await receive(line, 10);
    expect(await cost(part("BP-1234"))).toBe(60);
  });

  test("cost resets to the new price when the shelf was empty", async () => {
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 0 WHERE part_id = ${part("BP-1234")}`;
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 5, 80);
    await place(po);
    await receive(line, 5);
    expect(await cost(part("BP-1234"))).toBe(80);
  });

  test("each receipt is on the ledger with who received it", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 2);
    await place(po);
    await receive(line, 2);
    const [m] = await owner()<Row[]>`
      SELECT kind, delta, user_id FROM grip.stock_movements
      WHERE part_id = ${part("BP-1234")} AND kind = 'receive' ORDER BY id DESC LIMIT 1`;
    expect(m.delta).toBe(2);
    expect(m.user_id).toBe(shop.users.parts_advisor);
  });
});

describe("receiving fills backorders", () => {
  test("stock that arrives is allocated to waiting jobs, oldest first", async () => {
    // Only 1 alternator on hand; two jobs each want 2 with backorder allowed.
    const woA = await createWorkOrder(shop);
    const woB = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${woA}, ${part("ALT-7781")}, 2, ${shop.users.parts_advisor}, true)`);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${woB}, ${part("ALT-7781")}, 2, ${shop.users.parts_advisor}, true)`);

    // A took the 1 in stock (1 backordered); B got none (2 backordered).
    const before = await owner()<Row[]>`
      SELECT work_order_id, qty_reserved, qty_backordered FROM grip.work_order_part_lines
      WHERE part_id = ${part("ALT-7781")} ORDER BY created_at`;
    expect(before.map((r) => [r.qty_reserved, r.qty_backordered])).toEqual([[1, 1], [0, 2]]);

    const po = await newPo();
    const line = await addLine(po, "ALT-7781", 3);
    await place(po);
    const filled = await receive(line, 3);

    // 3 arrive: A needs 1 more, B needs 2 -> all 3 allocated, in that order.
    expect(filled).toBe(3);
    const after = await owner()<Row[]>`
      SELECT qty_reserved, qty_backordered FROM grip.work_order_part_lines
      WHERE part_id = ${part("ALT-7781")} ORDER BY created_at`;
    expect(after.map((r) => [r.qty_reserved, r.qty_backordered])).toEqual([[2, 0], [2, 0]]);

    const s = await stockOf(part("ALT-7781"));
    expect(s.onHand).toBe(4);
    expect(s.reserved).toBe(4);
    expect(s.available).toBe(0);
  });

  test("when less arrives than is owed, the oldest job is served first", async () => {
    const woA = await createWorkOrder(shop);
    const woB = await createWorkOrder(shop);
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 0 WHERE part_id = ${part("ALT-7781")}`;
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${woA}, ${part("ALT-7781")}, 2, ${shop.users.parts_advisor}, true)`);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${woB}, ${part("ALT-7781")}, 2, ${shop.users.parts_advisor}, true)`);

    const po = await newPo();
    const line = await addLine(po, "ALT-7781", 3);
    await place(po);
    await receive(line, 3);

    const lines = await owner()<Row[]>`
      SELECT qty_reserved, qty_backordered FROM grip.work_order_part_lines
      WHERE part_id = ${part("ALT-7781")} ORDER BY created_at`;
    expect(lines.map((r) => [r.qty_reserved, r.qty_backordered])).toEqual([[2, 0], [1, 1]]);
  });

  test("a cancelled or invoiced job is never allocated stock", async () => {
    const wo = await createWorkOrder(shop);
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 0 WHERE part_id = ${part("ALT-7781")}`;
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${part("ALT-7781")}, 1, ${shop.users.parts_advisor}, true)`);
    await owner()`UPDATE grip.work_orders SET status = 'cancelled' WHERE id = ${wo}`;

    const po = await newPo();
    const line = await addLine(po, "ALT-7781", 1);
    await place(po);
    expect(await receive(line, 1)).toBe(0);
    expect((await stockOf(part("ALT-7781"))).reserved).toBe(0);
  });

  test("the job's activity feed records the allocation", async () => {
    const wo = await createWorkOrder(shop);
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 0 WHERE part_id = ${part("ALT-7781")}`;
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${part("ALT-7781")}, 1, ${shop.users.parts_advisor}, true)`);
    const po = await newPo();
    const line = await addLine(po, "ALT-7781", 1);
    await place(po);
    await receive(line, 1);

    const [a] = await owner()<Row[]>`
      SELECT action FROM grip.audit_log WHERE entity_id = ${wo} AND action = 'part.backorder_filled'`;
    expect(a).toBeTruthy();
  });
});

describe("cancelling a purchase order", () => {
  test("cancelling a placed order takes it back off 'on order'", async () => {
    const po = await newPo();
    await addLine(po, "BP-1234", 8);
    await place(po);
    await as("parts_advisor", (tx) => tx`SELECT grip.cancel_purchase_order(${po})`);

    expect(await poStatus(po)).toBe("cancelled");
    expect(await onOrder(part("BP-1234"))).toBe(0);
  });

  test("cancelling after a partial delivery closes it short and keeps the receipts", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 10);
    await place(po);
    await receive(line, 4);
    await as("parts_advisor", (tx) => tx`SELECT grip.cancel_purchase_order(${po})`);

    expect(await poStatus(po)).toBe("received");
    expect(await onOrder(part("BP-1234"))).toBe(0);
    expect((await stockOf(part("BP-1234"))).onHand).toBe(14);
  });

  test("a received order cannot be cancelled", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 1);
    await place(po);
    await receive(line, 1);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.cancel_purchase_order(${po})`))
      .rejects.toThrow(/cannot be cancelled/i);
  });
});

describe("reorder suggestions", () => {
  test("builds a draft for supplier parts at or below their reorder point", async () => {
    await owner()`UPDATE grip.parts SET supplier_id = ${supplierId}, reorder_point = 5, reorder_qty = 12
                  WHERE id = ${part("BP-1234")}`;
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 4 WHERE part_id = ${part("BP-1234")}`;
    // Plenty of oil filters: must not be included.
    await owner()`UPDATE grip.parts SET supplier_id = ${supplierId}, reorder_point = 5, reorder_qty = 20
                  WHERE id = ${part("OF-0090")}`;

    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`SELECT grip.create_reorder_po(${supplierId}) AS id`);
    const lines = await owner()<Row[]>`
      SELECT part_id, qty_ordered FROM grip.purchase_order_lines WHERE purchase_order_id = ${r.id}`;
    expect(lines).toHaveLength(1);
    expect(lines[0].part_id).toBe(part("BP-1234"));
    expect(lines[0].qty_ordered).toBe(12);
  });

  test("counts what is already on order, so it does not double up", async () => {
    await owner()`UPDATE grip.parts SET supplier_id = ${supplierId}, reorder_point = 5, reorder_qty = 12
                  WHERE id = ${part("BP-1234")}`;
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 4, qty_on_order = 12 WHERE part_id = ${part("BP-1234")}`;

    await expect(as("parts_advisor", (tx) => tx`SELECT grip.create_reorder_po(${supplierId})`))
      .rejects.toThrow(/nothing from this supplier/i);
  });

  test("stock reserved for jobs counts as already gone", async () => {
    // 8 on hand but 5 reserved: only 3 truly available, below a reorder point of 5.
    await owner()`UPDATE grip.parts SET supplier_id = ${supplierId}, reorder_point = 5, reorder_qty = 10
                  WHERE id = ${part("BP-1234")}`;
    await owner()`UPDATE grip.part_stock SET qty_on_hand = 8, qty_reserved = 5 WHERE part_id = ${part("BP-1234")}`;

    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`SELECT grip.create_reorder_po(${supplierId}) AS id`);
    expect(r.id).toBeTruthy();
  });
});

describe("counts and adjustments", () => {
  test("a cycle count corrects stock and records the difference", async () => {
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT grip.count_stock(${part("BP-1234")}, 7, 'bin A-01') AS delta`);
    expect(r.delta).toBe(-3);
    expect((await stockOf(part("BP-1234"))).onHand).toBe(7);

    const [m] = await owner()<Row[]>`
      SELECT kind, delta, note FROM grip.stock_movements
      WHERE part_id = ${part("BP-1234")} AND kind = 'adjust' ORDER BY id DESC LIMIT 1`;
    expect(m.delta).toBe(-3);
    expect(m.note).toMatch(/counted 7, system had 10/);
  });

  test("a count that matches changes nothing", async () => {
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`
      SELECT grip.count_stock(${part("BP-1234")}, 10) AS delta`);
    expect(r.delta).toBe(0);
  });

  test("cannot count or adjust below what is reserved for open jobs", async () => {
    const wo = await createWorkOrder(shop);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${wo}, ${part("BP-1234")}, 6, ${shop.users.parts_advisor})`);

    await expect(as("parts_advisor", (tx) => tx`SELECT grip.count_stock(${part("BP-1234")}, 4)`))
      .rejects.toThrow(/6 are reserved/i);
    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.adjust_stock(${part("BP-1234")}, -5, 'damaged', ${shop.users.parts_advisor})`))
      .rejects.toThrow(/reserved/i);
    expect((await stockOf(part("BP-1234"))).onHand).toBe(10);
  });

  test("an adjustment needs a reason", async () => {
    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.adjust_stock(${part("BP-1234")}, -1, '  ', ${shop.users.parts_advisor})`))
      .rejects.toThrow(/reason is required/i);
  });

  test("adjustments are audited against the part", async () => {
    await as("parts_advisor", (tx) => tx`
      SELECT grip.adjust_stock(${part("BP-1234")}, -1, 'dropped', ${shop.users.parts_advisor})`);
    const [a] = await owner()<Row[]>`
      SELECT actor_user_id FROM grip.audit_log WHERE entity_id = ${part("BP-1234")} AND action = 'stock.adjusted'`;
    expect(a.actor_user_id).toBe(shop.users.parts_advisor);
  });
});

describe("counter sales", () => {
  const newSale = async () => {
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`SELECT grip.create_counter_sale(NULL, NULL) AS id`);
    return r.id as string;
  };
  const sell = (sale: string, sku: string, qty: number) =>
    as("parts_advisor", async (tx) => {
      const [r] = await tx<Row[]>`
        SELECT grip.add_part_to_counter_sale(${sale}, ${part(sku)}, ${qty}, ${shop.users.parts_advisor}) AS id`;
      return r.id as string;
    });

  test("opens as a walk-in with the shop's default tax", async () => {
    const id = await newSale();
    const [s] = await owner()<Row[]>`SELECT * FROM grip.counter_sales WHERE id = ${id}`;
    expect(s.status).toBe("open");
    expect(s.customer_name).toBe("Walk-in");
    expect(s.tax_rate_id).toBe(shop.taxRateId);
  });

  test("adding a part takes it off the shelf and totals with tax", async () => {
    const id = await newSale();
    await sell(id, "BP-1234", 2); // 2 x $100
    expect((await stockOf(part("BP-1234"))).onHand).toBe(8);

    const [s] = await owner()<Row[]>`SELECT subtotal, tax_total, total FROM grip.counter_sales WHERE id = ${id}`;
    expect(Number(s.subtotal)).toBe(200);
    expect(Number(s.tax_total)).toBe(26); // HST 13%
    expect(Number(s.total)).toBe(226);
  });

  test("removing a line puts the stock back and logs a return", async () => {
    const id = await newSale();
    const line = await sell(id, "BP-1234", 3);
    await as("parts_advisor", (tx) => tx`SELECT grip.remove_counter_sale_line(${line})`);

    expect((await stockOf(part("BP-1234"))).onHand).toBe(10);
    const [m] = await owner()<Row[]>`
      SELECT kind, delta FROM grip.stock_movements
      WHERE part_id = ${part("BP-1234")} ORDER BY id DESC LIMIT 1`;
    expect([m.kind, m.delta]).toEqual(["return", 3]);
  });

  test("cancelling returns everything", async () => {
    const id = await newSale();
    await sell(id, "BP-1234", 3);
    await sell(id, "OF-0090", 5);
    await as("parts_advisor", (tx) => tx`SELECT grip.cancel_counter_sale(${id})`);

    expect((await stockOf(part("BP-1234"))).onHand).toBe(10);
    expect((await stockOf(part("OF-0090"))).onHand).toBe(50);
  });

  test("completing stamps the sale, and a completed sale is locked", async () => {
    const id = await newSale();
    const line = await sell(id, "BP-1234", 1);
    await as("parts_advisor", (tx) => tx`SELECT grip.complete_counter_sale(${id})`);

    const [s] = await owner()<Row[]>`SELECT status, completed_at FROM grip.counter_sales WHERE id = ${id}`;
    expect(s.status).toBe("completed");
    expect(s.completed_at).not.toBeNull();

    await expect(sell(id, "BP-1234", 1)).rejects.toThrow(/cannot be changed/i);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.remove_counter_sale_line(${line})`))
      .rejects.toThrow(/cannot be changed/i);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.cancel_counter_sale(${id})`))
      .rejects.toThrow(/cannot be changed/i);
  });

  test("cannot complete an empty sale", async () => {
    const id = await newSale();
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.complete_counter_sale(${id})`))
      .rejects.toThrow(/at least one part/i);
  });

  test("no overselling, and no backordering over the counter", async () => {
    const id = await newSale();
    await expect(sell(id, "ALT-7781", 2)).rejects.toThrow(/insufficient stock/i);
    // Even asking for backorder explicitly does not allow it.
    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_counter_sale(${id}, ${part("ALT-7781")}, 2, ${shop.users.parts_advisor}, true)`))
      .rejects.toThrow(/insufficient stock/i);
    expect((await stockOf(part("ALT-7781"))).onHand).toBe(1);
  });

  test("tax can be switched on the sale and recalculates", async () => {
    const id = await newSale();
    await sell(id, "BP-1234", 1);
    await as("parts_advisor", (tx) => tx`SELECT grip.set_counter_sale_tax(${id}, NULL)`);
    const [s] = await owner()<Row[]>`SELECT tax_total, total FROM grip.counter_sales WHERE id = ${id}`;
    expect(Number(s.tax_total)).toBe(0);
    expect(Number(s.total)).toBe(100);
  });

  test("a customer's own tax rate is used when one is chosen", async () => {
    const [ex] = await owner()<Row[]>`
      INSERT INTO grip.tax_rates (tenant_id, name) VALUES (${shop.tenantId}, 'Fleet exempt') RETURNING id`;
    const [c] = await owner()<Row[]>`
      INSERT INTO grip.customers (tenant_id, display_name, tax_rate_id)
      VALUES (${shop.tenantId}, 'Fleet Co', ${ex.id}) RETURNING id`;
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`SELECT grip.create_counter_sale(${c.id}, NULL) AS id`);
    const [s] = await owner()<Row[]>`SELECT tax_rate_id, customer_name FROM grip.counter_sales WHERE id = ${r.id}`;
    expect(s.tax_rate_id).toBe(ex.id);
    expect(s.customer_name).toBe("Fleet Co");
  });

  test("each sale and removal is audited with the person responsible", async () => {
    const id = await newSale();
    const line = await sell(id, "BP-1234", 1);
    await as("parts_advisor", (tx) => tx`SELECT grip.remove_counter_sale_line(${line})`);
    const log = await owner()<Row[]>`
      SELECT a.action, u.role FROM grip.audit_log a JOIN grip.users u ON u.id = a.actor_user_id
      WHERE a.entity_id = ${id} ORDER BY a.id`;
    expect(log.map((l) => [l.action, l.role])).toEqual([
      ["counter_sale.created", "parts_advisor"],
      ["part.sold", "parts_advisor"],
      ["part.unsold", "parts_advisor"],
    ]);
  });
});

describe("tenant isolation of the new functions", () => {
  test("cannot order from another shop's supplier", async () => {
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.create_purchase_order(${otherSupplierId})`))
      .rejects.toThrow(/supplier not found/i);
  });

  test("cannot put another shop's part on an order", async () => {
    const po = await newPo();
    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.add_purchase_order_line(${po}, ${other.parts["BP-1234"]}, 1)`))
      .rejects.toThrow(/part not found/i);
  });

  test("cannot receive, cancel or count across shops", async () => {
    const po = await newPo();
    const line = await addLine(po, "BP-1234", 1);
    await place(po);

    await expect(as("parts_advisor", (tx) => tx`
      SELECT grip.receive_purchase_order_line(${line}, 1, ${other.users.parts_advisor})`, other))
      .rejects.toThrow(/not found/i);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.cancel_purchase_order(${po})`, other))
      .rejects.toThrow(/not found/i);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.count_stock(${part("BP-1234")}, 0)`, other))
      .rejects.toThrow(/part not found/i);
    expect((await stockOf(part("BP-1234"))).onHand).toBe(10);
  });

  test("cannot sell, complete or cancel another shop's counter sale", async () => {
    const [r] = await as("parts_advisor", (tx) => tx<Row[]>`SELECT grip.create_counter_sale(NULL, NULL) AS id`);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.complete_counter_sale(${r.id})`, other))
      .rejects.toThrow(/not found/i);
    await expect(as("parts_advisor", (tx) => tx`SELECT grip.cancel_counter_sale(${r.id})`, other))
      .rejects.toThrow(/not found/i);
  });
});
