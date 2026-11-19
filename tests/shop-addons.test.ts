/**
 * The client email/SMS add-on: who can turn it on, and the rules
 * grip.send_client_message enforces once it is on.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, createWorkOrder, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

async function activateAddon(s: Shop) {
  await owner()`
    INSERT INTO grip.shop_addons (tenant_id, addon_key, status, granted_at)
    VALUES (${s.tenantId}, 'client_messaging', 'active', now())
    ON CONFLICT (tenant_id, addon_key) DO UPDATE SET status = 'active', granted_at = now()`;
}

async function setContact(customerId: string, email: string | null, phone: string | null) {
  await owner()`UPDATE grip.customers SET email = ${email}, phone = ${phone} WHERE id = ${customerId}`;
}

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("addon-shop");
  shop = await createShop("addon-shop");
});

afterAll(async () => {
  await dropShops("addon-shop");
  await closeAll();
});

describe("requesting the add-on", () => {
  test("a shop admin can request it, landing in 'requested'", async () => {
    await as("shop_admin", (tx) => tx`SELECT grip.request_addon('client_messaging'::grip.addon_key, 'please')`);
    const [row] = await owner()<Row[]>`
      SELECT status, note FROM grip.shop_addons WHERE tenant_id = ${shop.tenantId} AND addon_key = 'client_messaging'`;
    expect(row.status).toBe("requested");
    expect(row.note).toBe("please");
  });

  test("a shop cannot write its own row to 'active' — RLS rejects it even though the row is theirs", async () => {
    await expect(
      as("shop_admin", (tx) => tx`
        UPDATE grip.shop_addons SET status = 'active'
        WHERE tenant_id = ${shop.tenantId} AND addon_key = 'client_messaging'`),
    ).rejects.toThrow();

    const [row] = await owner()<Row[]>`
      SELECT status FROM grip.shop_addons WHERE tenant_id = ${shop.tenantId} AND addon_key = 'client_messaging'`;
    expect(row.status).toBe("requested");
  });

  test("a platform admin session can grant it", async () => {
    await asTenant(app(), { tenantId: shop.tenantId, userId: shop.users.shop_admin, isPlatformAdmin: true },
      (tx) => tx`
        UPDATE grip.shop_addons SET status = 'active'
        WHERE tenant_id = ${shop.tenantId} AND addon_key = 'client_messaging'`);
    const [row] = await owner()<Row[]>`
      SELECT status FROM grip.shop_addons WHERE tenant_id = ${shop.tenantId} AND addon_key = 'client_messaging'`;
    expect(row.status).toBe("active");
  });
});

describe("sending a client message, once the add-on is active", () => {
  test("rejects when the order isn't open yet (a quote)", async () => {
    await activateAddon(shop);
    await setContact(shop.customerId, "dave@example.com", "9055550100");
    const quoteId = await createWorkOrder(shop, "quote");

    await expect(
      as("service_advisor", (tx) => tx`
        SELECT grip.send_client_message(${quoteId}, 'email'::grip.message_channel, 'hi')`),
    ).rejects.toThrow(/only available while a work order is open/i);
  });

  test("rejects once the order is closed (invoiced)", async () => {
    const invoicedId = await createWorkOrder(shop, "invoiced");
    await expect(
      as("service_advisor", (tx) => tx`
        SELECT grip.send_client_message(${invoicedId}, 'email'::grip.message_channel, 'hi')`),
    ).rejects.toThrow(/only available while a work order is open/i);
  });

  test("sends on an open order and records the right to_address", async () => {
    const openId = await createWorkOrder(shop, "in_progress");
    const [{ send_client_message: msgId }] = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT grip.send_client_message(${openId}, 'email'::grip.message_channel, 'Your car is ready.') AS send_client_message`);

    const [row] = await owner()<Row[]>`SELECT * FROM grip.client_messages WHERE id = ${msgId}`;
    expect(row.channel).toBe("email");
    expect(row.to_address).toBe("dave@example.com");
    expect(row.status).toBe("queued");
  });

  test("rejects when the customer has no phone on file, for sms", async () => {
    await setContact(shop.customerId, "dave@example.com", null);
    const openId = await createWorkOrder(shop, "approved");
    await expect(
      as("service_advisor", (tx) => tx`
        SELECT grip.send_client_message(${openId}, 'sms'::grip.message_channel, 'hi')`),
    ).rejects.toThrow(/no phone number on file/i);
    await setContact(shop.customerId, "dave@example.com", "9055550100");
  });

  test("rejects once the add-on is suspended again", async () => {
    await owner()`
      UPDATE grip.shop_addons SET status = 'suspended'
      WHERE tenant_id = ${shop.tenantId} AND addon_key = 'client_messaging'`;
    const openId = await createWorkOrder(shop, "approved");
    await expect(
      as("service_advisor", (tx) => tx`
        SELECT grip.send_client_message(${openId}, 'email'::grip.message_channel, 'hi')`),
    ).rejects.toThrow(/isn't turned on/i);
  });
});
