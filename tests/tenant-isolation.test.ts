/**
 * Tenant isolation — the single most important correctness property in Grip.
 *
 * Every test here runs on the restricted `grip_app` connection, because that
 * is what serves a request. Reading is only half of it: the tests that matter
 * most are the ones proving tenant A cannot *write* into tenant B, which is
 * the half that application-level `WHERE tenant_id = ...` filtering misses.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, createWorkOrder, closeAll, dropShops, type Shop,
} from "./helpers";

let redline: Shop;
let northside: Shop;

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("iso-redline", "iso-northside");
  redline = await createShop("iso-redline");
  northside = await createShop("iso-northside");
});

afterAll(async () => {
  await dropShops("iso-redline", "iso-northside");
  await closeAll();
});

const asRedline = <T>(fn: Parameters<typeof asTenant<T>>[2]) =>
  asTenant(app(), { tenantId: redline.tenantId, userId: redline.users.shop_admin }, fn);

describe("reading across the boundary", () => {
  test("a shop sees only its own customers", async () => {
    const rows = await asRedline((tx) => tx`SELECT id, tenant_id FROM grip.customers`);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(redline.tenantId);
    expect(rows[0].id).toBe(redline.customerId);
  });

  test("both shops have a customer called Dave; each sees only their own", async () => {
    const mine = await asRedline((tx) =>
      tx`SELECT id FROM grip.customers WHERE display_name = 'Dave Mercer'`);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(redline.customerId);
    expect(mine[0].id).not.toBe(northside.customerId);
  });

  test("asking for the other shop's row by primary key returns nothing", async () => {
    const rows = await asRedline((tx) =>
      tx`SELECT id FROM grip.customers WHERE id = ${northside.customerId}`);
    expect(rows).toHaveLength(0);
  });

  test("the other shop's parts and stock are invisible", async () => {
    const parts = await asRedline((tx) =>
      tx`SELECT id FROM grip.parts WHERE id = ${northside.parts["BP-1234"]}`);
    expect(parts).toHaveLength(0);

    const stock = await asRedline((tx) =>
      tx`SELECT part_id FROM grip.part_stock WHERE part_id = ${northside.parts["BP-1234"]}`);
    expect(stock).toHaveLength(0);
  });

  test("the other shop's users are invisible", async () => {
    const rows = await asRedline((tx) =>
      tx`SELECT id FROM grip.users WHERE tenant_id = ${northside.tenantId}`);
    expect(rows).toHaveLength(0);
  });

  test("an unfiltered select over every tenant table returns only this tenant", async () => {
    const tables = [
      "customers", "vehicles", "parts", "part_stock", "work_orders",
      "tax_rates", "users", "suppliers", "employees", "appointments",
    ];
    for (const table of tables) {
      const rows = await asRedline((tx) =>
        tx.unsafe(`SELECT tenant_id FROM grip.${table}`));
      for (const row of rows as unknown as { tenant_id: string }[]) {
        expect(row.tenant_id, `${table} leaked a row`).toBe(redline.tenantId);
      }
    }
  });
});

describe("writing across the boundary", () => {
  test("cannot INSERT a row carrying another tenant's id", async () => {
    await expect(
      asRedline((tx) => tx`
        INSERT INTO grip.customers (tenant_id, display_name)
        VALUES (${northside.tenantId}, 'Planted by Redline')`),
    ).rejects.toThrow(/row-level security/i);

    // And nothing landed.
    const [{ count }] = await owner()<{ count: string }[]>`
      SELECT count(*) FROM grip.customers
      WHERE tenant_id = ${northside.tenantId} AND display_name = 'Planted by Redline'`;
    expect(Number(count)).toBe(0);
  });

  test("cannot UPDATE another tenant's row", async () => {
    const result = await asRedline((tx) => tx`
      UPDATE grip.customers SET display_name = 'Stolen'
      WHERE id = ${northside.customerId}`);
    // The row is invisible, so the UPDATE matches nothing rather than erroring.
    expect(result.count).toBe(0);

    const [row] = await owner()<{ display_name: string }[]>`
      SELECT display_name FROM grip.customers WHERE id = ${northside.customerId}`;
    expect(row.display_name).toBe("Dave Mercer");
  });

  test("cannot re-parent its own row into another tenant", async () => {
    // The sneaky one: the row IS visible, so USING passes. WITH CHECK is what
    // has to stop the new tenant_id.
    await expect(
      asRedline((tx) => tx`
        UPDATE grip.customers SET tenant_id = ${northside.tenantId}
        WHERE id = ${redline.customerId}`),
    ).rejects.toThrow(/row-level security/i);

    const [row] = await owner()<{ tenant_id: string }[]>`
      SELECT tenant_id FROM grip.customers WHERE id = ${redline.customerId}`;
    expect(row.tenant_id).toBe(redline.tenantId);
  });

  test("cannot DELETE another tenant's row", async () => {
    const result = await asRedline((tx) =>
      tx`DELETE FROM grip.customers WHERE id = ${northside.customerId}`);
    expect(result.count).toBe(0);

    const [{ count }] = await owner()<{ count: string }[]>`
      SELECT count(*) FROM grip.customers WHERE id = ${northside.customerId}`;
    expect(Number(count)).toBe(1);
  });

  test("cannot move stock belonging to another tenant", async () => {
    const before = await owner()<{ qty_on_hand: number }[]>`
      SELECT qty_on_hand FROM grip.part_stock WHERE part_id = ${northside.parts["BP-1234"]}`;

    const result = await asRedline((tx) => tx`
      UPDATE grip.part_stock SET qty_on_hand = 0
      WHERE part_id = ${northside.parts["BP-1234"]}`);
    expect(result.count).toBe(0);

    const after = await owner()<{ qty_on_hand: number }[]>`
      SELECT qty_on_hand FROM grip.part_stock WHERE part_id = ${northside.parts["BP-1234"]}`;
    expect(after[0].qty_on_hand).toBe(before[0].qty_on_hand);
  });
});

describe("the business functions respect the boundary too", () => {
  test("cannot add a part to another tenant's work order", async () => {
    const theirWo = await createWorkOrder(northside);

    await expect(
      asRedline((tx) => tx`
        SELECT grip.add_part_to_work_order(
          ${theirWo}, ${redline.parts["BP-1234"]}, 1, ${redline.users.parts_advisor})`),
    ).rejects.toThrow(/work order .* not found/i);
  });

  test("cannot allocate another tenant's part onto its own work order", async () => {
    const myWo = await createWorkOrder(redline);

    await expect(
      asRedline((tx) => tx`
        SELECT grip.add_part_to_work_order(
          ${myWo}, ${northside.parts["BP-1234"]}, 1, ${redline.users.parts_advisor})`),
    ).rejects.toThrow(/part .* not found/i);
  });

  test("document numbers do not leak between shops", async () => {
    const a = await asRedline((tx) =>
      tx<{ next_document_number: number }[]>`SELECT grip.next_document_number('test_doc')`);
    const b = await asTenant(
      app(),
      { tenantId: northside.tenantId, userId: northside.users.shop_admin },
      (tx) => tx<{ next_document_number: number }[]>`SELECT grip.next_document_number('test_doc')`,
    );
    // Each shop starts its own run at 1001 rather than sharing a sequence.
    expect(a[0].next_document_number).toBe(b[0].next_document_number);
  });
});

describe("the unscoped connection", () => {
  test("a query with no tenant set raises rather than returning nothing", async () => {
    // A silent empty result hides the bug; an exception does not.
    await expect(
      app().begin((tx) => tx`SELECT id FROM grip.customers`),
    ).rejects.toThrow(/app\.tenant_id is not set/i);
  });

  test("the setting does not survive the transaction that set it", async () => {
    await asRedline((tx) => tx`SELECT 1`);
    // Same pool, likely the same physical connection, new transaction.
    await expect(
      app().begin((tx) => tx`SELECT id FROM grip.customers`),
    ).rejects.toThrow(/app\.tenant_id is not set/i);
  });
});

describe("the platform super-admin", () => {
  const asOperator = <T>(fn: Parameters<typeof asTenant<T>>[2]) =>
    asTenant(
      app(),
      { tenantId: redline.tenantId, userId: redline.users.shop_admin, isPlatformAdmin: true },
      fn,
    );

  test("sees across tenants", async () => {
    const rows = await asOperator((tx) => tx<{ id: string }[]>`
      SELECT id FROM grip.customers
      WHERE id IN (${redline.customerId}, ${northside.customerId})`);
    expect(rows).toHaveLength(2);
  });

  test("a shop admin is not silently promoted by asking nicely", async () => {
    // The flag comes from the verified session, never from the request. This
    // asserts the flag is what gates it, nothing else.
    const rows = await asRedline((tx) => tx<{ id: string }[]>`
      SELECT id FROM grip.customers
      WHERE id IN (${redline.customerId}, ${northside.customerId})`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(redline.customerId);
  });
});

describe("the append-only ledgers", () => {
  test("stock movements cannot be updated or deleted by the app role", async () => {
    const wo = await createWorkOrder(redline);
    await asRedline((tx) => tx`
      SELECT grip.add_part_to_work_order(
        ${wo}, ${redline.parts["BP-1234"]}, 1, ${redline.users.parts_advisor})`);

    await expect(
      asRedline((tx) => tx`UPDATE grip.stock_movements SET delta = 999 WHERE tenant_id = ${redline.tenantId}`),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asRedline((tx) => tx`DELETE FROM grip.stock_movements WHERE tenant_id = ${redline.tenantId}`),
    ).rejects.toThrow(/permission denied/i);
  });
});
