/**
 * Intershop messaging: direct messages between coworkers at the same shop.
 * Covers the pairing rule (one thread per pair, either direction), the
 * privacy boundary RLS adds on top of the tenant boundary (shop A's own
 * admin still can't read a DM between two shop A coworkers unless they're
 * on it), and the business rules in grip.send_message.
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

const send = (fromRole: string, toUserId: string, body: string, s: Shop = shop) =>
  as(fromRole, (tx) => tx<Row[]>`SELECT grip.send_message(${toUserId}, ${body}) AS id`, s)
    .then((rows) => rows[0].id as string);

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("msg-shop", "msg-other");
  shop = await createShop("msg-shop");
  other = await createShop("msg-other");
});

afterAll(async () => {
  await dropShops("msg-shop", "msg-other");
  await closeAll();
});

describe("sending a message", () => {
  test("creates one thread for a pair, reused on the reply", async () => {
    await send("service_advisor", shop.users["technician"], "Can you look at bay 2?");
    await send("technician", shop.users["service_advisor"], "On it.");

    const threads = await owner()<Row[]>`
      SELECT * FROM grip.message_threads WHERE tenant_id = ${shop.tenantId}`;
    expect(threads).toHaveLength(1);

    const messages = await owner()<Row[]>`
      SELECT body, sender_id FROM grip.messages WHERE thread_id = ${threads[0].id} ORDER BY created_at`;
    expect(messages.map((m) => m.body)).toEqual(["Can you look at bay 2?", "On it."]);
  });

  test("the pair is stored the same way regardless of who messaged first", async () => {
    await dropShops("msg-shop"); shop = await createShop("msg-shop");
    await send("parts_advisor", shop.users["shop_admin"], "Hi");
    const [t1] = await owner()<Row[]>`SELECT user_a_id, user_b_id FROM grip.message_threads WHERE tenant_id = ${shop.tenantId}`;

    // Same two people, opposite direction — must land on the exact same row,
    // not a second thread.
    await send("shop_admin", shop.users["parts_advisor"], "Hey");
    const threads = await owner()<Row[]>`SELECT * FROM grip.message_threads WHERE tenant_id = ${shop.tenantId}`;
    expect(threads).toHaveLength(1);
    expect(threads[0].user_a_id).toBe(t1.user_a_id);
    expect(threads[0].user_b_id).toBe(t1.user_b_id);
  });

  test("rejects messaging yourself", async () => {
    await expect(send("technician", shop.users["technician"], "echo"))
      .rejects.toThrow(/can't message yourself/i);
  });

  test("rejects an empty message", async () => {
    await expect(send("technician", shop.users["service_advisor"], "   "))
      .rejects.toThrow(/write something/i);
  });

  test("rejects messaging someone at another shop", async () => {
    await expect(send("technician", other.users["service_advisor"], "hi"))
      .rejects.toThrow(/not available to message/i);
  });
});

describe("tenant and participant isolation", () => {
  test("a shop can't see another shop's threads or messages at all", async () => {
    await dropShops("msg-shop", "msg-other");
    shop = await createShop("msg-shop");
    other = await createShop("msg-other");
    await send("service_advisor", shop.users["technician"], "shop A only");
    await send("service_advisor", other.users["technician"], "shop B only");

    const seenFromA = await as("shop_admin", (tx) => tx<Row[]>`SELECT * FROM grip.messages`);
    expect(seenFromA.map((m) => m.body)).toEqual(["shop A only"]);
  });

  test("within the same shop, a third coworker cannot read someone else's DM", async () => {
    const threadId = await send("service_advisor", shop.users["technician"], "private to these two")
      .then(async (msgId) => {
        const [row] = await owner()<Row[]>`SELECT thread_id FROM grip.messages WHERE id = ${msgId}`;
        return row.thread_id as string;
      });

    // shop_admin is a real, active coworker at the same shop, but isn't on
    // this thread — RLS, not just the query layer, must keep it invisible.
    const visibleThreads = await as("shop_admin", (tx) => tx<Row[]>`
      SELECT * FROM grip.message_threads WHERE id = ${threadId}`);
    expect(visibleThreads).toHaveLength(0);

    const visibleMessages = await as("shop_admin", (tx) => tx<Row[]>`
      SELECT * FROM grip.messages WHERE thread_id = ${threadId}`);
    expect(visibleMessages).toHaveLength(0);

    // The two actual participants still see it fine.
    const forSender = await as("service_advisor", (tx) => tx<Row[]>`
      SELECT * FROM grip.messages WHERE thread_id = ${threadId}`);
    expect(forSender).toHaveLength(1);
  });

  test("mark_thread_read is a no-op for someone not on the thread, and marks read for a participant", async () => {
    const msgId = await send("service_advisor", shop.users["technician"], "read me");
    const [row] = await owner()<Row[]>`SELECT thread_id FROM grip.messages WHERE id = ${msgId}`;
    const threadId = row.thread_id as string;

    await as("shop_admin", (tx) => tx`SELECT grip.mark_thread_read(${threadId})`);
    const untouched = await owner()<Row[]>`
      SELECT user_a_last_read_at, user_b_last_read_at FROM grip.message_threads WHERE id = ${threadId}`;
    expect(untouched[0].user_a_last_read_at).toBeNull();
    expect(untouched[0].user_b_last_read_at).toBeNull();

    await as("technician", (tx) => tx`SELECT grip.mark_thread_read(${threadId})`);
    const after = await owner()<Row[]>`
      SELECT user_a_id, user_a_last_read_at, user_b_last_read_at FROM grip.message_threads WHERE id = ${threadId}`;
    const techIsA = after[0].user_a_id === shop.users["technician"];
    expect(techIsA ? after[0].user_a_last_read_at : after[0].user_b_last_read_at).not.toBeNull();
  });
});
