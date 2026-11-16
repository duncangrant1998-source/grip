/**
 * Service shortcuts (LOF and friends), plus the delete-a-part-from-an-order
 * behaviour they sit next to: stock reserved for a deleted line goes back on the
 * shelf, and a shop can only ever see and apply its own shortcuts.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, stockOf, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let lofId: string;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const newOrder = async (s = shop) => {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_work_order(${s.customerId}, ${s.vehicleId}, 'Oil change', NULL) AS id`, s);
  return r.id as string;
};

const apply = (id: string, code: string, labour = true, parts = true, s = shop, role = "service_advisor") =>
  as(role, (tx) => tx<Row[]>`
    SELECT grip.apply_service_shortcut(${id}, ${code}, NULL, ${labour}, ${parts}) AS r`, s)
    .then((rows) => rows[0].r as Row);

const labourOf = (id: string) =>
  owner()<Row[]>`SELECT * FROM grip.work_order_labour_lines WHERE work_order_id = ${id} ORDER BY created_at, id`;
const partsOf = (id: string) =>
  owner()<Row[]>`SELECT * FROM grip.work_order_part_lines WHERE work_order_id = ${id}`;

async function makeShortcut(s: Shop, code: string, opts: {
  labour?: { description: string; hours: number; rate?: number | null; mode?: string | null }[];
  parts?: { partId: string; qty: number }[];
}) {
  const [sc] = await owner()<Row[]>`
    INSERT INTO grip.service_shortcuts (tenant_id, code, name)
    VALUES (${s.tenantId}, ${code}, ${code + " service"}) RETURNING id`;
  let i = 0;
  for (const l of opts.labour ?? []) {
    await owner()`
      INSERT INTO grip.service_shortcut_labour
        (tenant_id, shortcut_id, description, hours, rate, billing_mode, sort_order)
      VALUES (${s.tenantId}, ${sc.id}, ${l.description}, ${l.hours}, ${l.rate ?? null},
              ${l.mode ?? null}::grip.labour_billing_mode, ${i++})`;
  }
  for (const p of opts.parts ?? []) {
    await owner()`
      INSERT INTO grip.service_shortcut_parts (tenant_id, shortcut_id, part_id, qty, sort_order)
      VALUES (${s.tenantId}, ${sc.id}, ${p.partId}, ${p.qty}, ${i++})`;
  }
  return sc.id as string;
}

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("sc-shop", "sc-other");
  shop = await createShop("sc-shop", { "BP-1234": 10, "OF-0090": 50, "ALT-7781": 1 });
  other = await createShop("sc-other");

  await owner()`
    INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id)
    VALUES (${shop.tenantId}, 120.00, 'flat_rate', ${shop.taxRateId})`;

  lofId = await makeShortcut(shop, "LOF", {
    labour: [{ description: "Lube, oil and filter", hours: 0.5 }],
    parts: [{ partId: shop.parts["OF-0090"], qty: 2 }],
  });
  await makeShortcut(shop, "LABONLY", { labour: [{ description: "Inspection", hours: 1, rate: 80, mode: "straight_time" }] });
  await makeShortcut(shop, "PARTSONLY", { parts: [{ partId: shop.parts["BP-1234"], qty: 1 }] });
  await makeShortcut(shop, "ALT", { parts: [{ partId: shop.parts["ALT-7781"], qty: 3 }] });
  // The same code in another shop, with different content.
  await makeShortcut(other, "LOF", { labour: [{ description: "OTHER SHOP LOF", hours: 9 }] });
});

afterAll(async () => {
  await dropShops("sc-shop", "sc-other");
  await closeAll();
});

describe("applying a shortcut", () => {
  test("adds its labour at the shop rate and its parts from live stock", async () => {
    const id = await newOrder();
    const before = await stockOf(shop.parts["OF-0090"]);
    const result = await apply(id, "LOF");
    expect(result).toMatchObject({ labour: 1, parts: 1, backordered: 0 });

    const [l] = await labourOf(id);
    expect(l.description).toBe("Lube, oil and filter");
    expect(Number(l.billed_hours)).toBe(0.5);
    expect(Number(l.rate)).toBe(120);
    expect(l.billing_mode).toBe("flat_rate");

    const [p] = await partsOf(id);
    expect(p.qty).toBe(2);
    expect(p.qty_reserved).toBe(2);
    expect((await stockOf(shop.parts["OF-0090"])).reserved).toBe(before.reserved + 2);
  });

  test("totals include both halves", async () => {
    const id = await newOrder();
    await apply(id, "LOF");
    const [wo] = await owner()<Row[]>`SELECT labour_subtotal, parts_subtotal FROM grip.work_orders WHERE id = ${id}`;
    expect(Number(wo.labour_subtotal)).toBe(60);   // 0.5 h × $120
    expect(Number(wo.parts_subtotal)).toBe(200);   // 2 × $100
  });

  test("codes are case-insensitive and ignore surrounding spaces", async () => {
    const id = await newOrder();
    await apply(id, "  lof ");
    expect(await labourOf(id)).toHaveLength(1);
  });

  test("a shortcut can carry its own rate and billing mode", async () => {
    const id = await newOrder();
    await apply(id, "LABONLY");
    const [l] = await labourOf(id);
    expect(Number(l.rate)).toBe(80);
    expect(l.billing_mode).toBe("straight_time");
  });

  test("labour-only and parts-only shortcuts work", async () => {
    const a = await newOrder();
    expect(await apply(a, "LABONLY")).toMatchObject({ labour: 1, parts: 0 });
    expect(await partsOf(a)).toHaveLength(0);

    const b = await newOrder();
    expect(await apply(b, "PARTSONLY")).toMatchObject({ labour: 0, parts: 1 });
    expect(await labourOf(b)).toHaveLength(0);
  });

  test("a role that may only add parts gets only the parts", async () => {
    const id = await newOrder();
    expect(await apply(id, "LOF", false, true, shop, "parts_advisor")).toMatchObject({ labour: 0, parts: 1 });
    expect(await labourOf(id)).toHaveLength(0);
    expect(await partsOf(id)).toHaveLength(1);
  });

  test("applying something the role cannot add at all is refused", async () => {
    const id = await newOrder();
    await expect(apply(id, "LABONLY", false, true, shop, "parts_advisor")).rejects.toThrow(/can be added by your role/i);
    expect(await labourOf(id)).toHaveLength(0);
  });

  test("out-of-stock parts go on backorder and the rest still lands", async () => {
    const id = await newOrder();
    const result = await apply(id, "ALT"); // 3 wanted, 1 in stock
    expect(result).toMatchObject({ parts: 1, backordered: 2 });
    const [p] = await partsOf(id);
    expect(p.qty).toBe(3);
    expect(p.qty_reserved).toBe(1);
    expect(p.qty_backordered).toBe(2);
  });

  test("an unknown or inactive code is refused and changes nothing", async () => {
    const id = await newOrder();
    await expect(apply(id, "NOPE")).rejects.toThrow(/No shortcut with the code "NOPE"/);
    await owner()`UPDATE grip.service_shortcuts SET is_active = false WHERE tenant_id = ${shop.tenantId} AND code = 'LABONLY'`;
    await expect(apply(id, "LABONLY")).rejects.toThrow(/No shortcut/);
    await owner()`UPDATE grip.service_shortcuts SET is_active = true WHERE tenant_id = ${shop.tenantId} AND code = 'LABONLY'`;
    expect(await labourOf(id)).toHaveLength(0);
  });

  test("cannot be applied to a finished order", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'approved')`);
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'in_progress')`);
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'completed')`);
    await expect(apply(id, "LABONLY")).rejects.toThrow();
  });

  test("the audit trail records who used which shortcut", async () => {
    const id = await newOrder();
    await apply(id, "LOF");
    const rows = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE entity_id = ${id} AND action = 'shortcut.applied'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(shop.users.service_advisor);
    expect(rows[0].diff).toMatchObject({ code: "LOF", labour: 1, parts: 1 });
  });
});

describe("deleting a part from an order puts it back in inventory", () => {
  test("the reservation is released and the stock is available again", async () => {
    const id = await newOrder();
    const start = await stockOf(shop.parts["BP-1234"]);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 4, ${shop.users.parts_advisor})`);
    expect((await stockOf(shop.parts["BP-1234"])).available).toBe(start.available - 4);

    const [line] = await partsOf(id);
    await as("parts_advisor", (tx) => tx`
      SELECT grip.remove_part_from_work_order(${line.id}, ${shop.users.parts_advisor})`);

    expect(await partsOf(id)).toHaveLength(0);
    expect(await stockOf(shop.parts["BP-1234"])).toEqual(start);
    const [wo] = await owner()<Row[]>`SELECT parts_subtotal FROM grip.work_orders WHERE id = ${id}`;
    expect(Number(wo.parts_subtotal)).toBe(0);
  });

  test("a part a shortcut added can be deleted like any other", async () => {
    const id = await newOrder();
    const start = await stockOf(shop.parts["OF-0090"]);
    await apply(id, "LOF");
    const [line] = await partsOf(id);
    await as("service_advisor", (tx) => tx`
      SELECT grip.remove_part_from_work_order(${line.id}, ${shop.users.service_advisor})`);
    expect(await stockOf(shop.parts["OF-0090"])).toEqual(start);
  });

  test("a line whose parts were already used cannot be deleted", async () => {
    const id = await newOrder();
    await as("service_advisor", (tx) => tx`
      SELECT grip.add_part_to_work_order(${id}, ${shop.parts["BP-1234"]}, 1, ${shop.users.service_advisor})`);
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'approved')`);
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'in_progress')`);
    await as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${id}, 'completed')`);
    const [line] = await partsOf(id);
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.remove_part_from_work_order(${line.id}, ${shop.users.service_advisor})`)).rejects.toThrow();
  });
});

describe("shortcuts and tenant isolation", () => {
  test("a shop sees only its own shortcuts, even where codes collide", async () => {
    const mine = await as("service_advisor", (tx) => tx<Row[]>`SELECT code FROM grip.service_shortcuts`);
    expect(mine.map((r) => r.code).sort()).toEqual(["ALT", "LABONLY", "LOF", "PARTSONLY"]);
    const theirs = await as("service_advisor", (tx) => tx<Row[]>`SELECT description FROM grip.service_shortcut_labour`, other);
    expect(theirs.map((r) => r.description)).toEqual(["OTHER SHOP LOF"]);
  });

  test("the same code in two shops resolves to each shop's own content", async () => {
    const id = await newOrder();
    await apply(id, "LOF");
    const [l] = await labourOf(id);
    expect(l.description).toBe("Lube, oil and filter");
  });

  test("another shop's shortcut cannot be applied to this order", async () => {
    // other has LOF but no PARTSONLY; this shop's PARTSONLY must not resolve there.
    const [r] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.create_work_order(${other.customerId}, ${other.vehicleId}, NULL, NULL) AS id`, other);
    await expect(apply(r.id, "PARTSONLY", true, true, other)).rejects.toThrow(/No shortcut/);
  });

  test("a shop cannot write a shortcut into another shop", async () => {
    await expect(as("service_advisor", (tx) => tx`
      INSERT INTO grip.service_shortcuts (tenant_id, code, name)
      VALUES (${other.tenantId}, 'HACK', 'x')`)).rejects.toThrow();
  });

  test("a shortcut cannot point at another shop's part", async () => {
    await expect(as("service_advisor", async (tx) => {
      await tx`
        INSERT INTO grip.service_shortcut_parts (tenant_id, shortcut_id, part_id, qty)
        VALUES (${shop.tenantId}, ${lofId}, ${other.parts["BP-1234"]}, 1)`;
      // The row may insert (the FK only checks existence), but applying it must not
      // reach across: the part is invisible to this shop.
      const [r] = await tx<Row[]>`
        SELECT grip.create_work_order(${shop.customerId}, ${shop.vehicleId}, NULL, NULL) AS id`;
      await tx`SELECT grip.apply_service_shortcut(${r.id}, 'LOF', NULL, true, true)`;
    })).rejects.toThrow(/not found in this tenant/i);
    await owner()`DELETE FROM grip.service_shortcut_parts WHERE part_id = ${other.parts["BP-1234"]}`;
  });
});

describe("code format and uniqueness", () => {
  test("codes are unique within a shop", async () => {
    await expect(owner()`
      INSERT INTO grip.service_shortcuts (tenant_id, code, name) VALUES (${shop.tenantId}, 'LOF', 'dup')`).rejects.toThrow();
  });

  test.each(["lof", "has space", "WAY-TOO-LONG-CODE", "", "-X"])("rejects the code %j", async (code) => {
    await expect(owner()`
      INSERT INTO grip.service_shortcuts (tenant_id, code, name) VALUES (${shop.tenantId}, ${code}, 'x')`).rejects.toThrow();
  });

  test("deleting a shortcut leaves the orders that used it alone", async () => {
    const sc = await makeShortcut(shop, "TEMP", { labour: [{ description: "Temp job", hours: 1 }] });
    const id = await newOrder();
    await apply(id, "TEMP");
    await owner()`DELETE FROM grip.service_shortcuts WHERE id = ${sc}`;
    expect(await labourOf(id)).toHaveLength(1);
  });
});
