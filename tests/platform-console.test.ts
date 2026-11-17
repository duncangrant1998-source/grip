/**
 * Platform console: support requests, security events, payments, and the
 * notification feed tying them together (0022).
 *
 * The RLS story has two shapes to prove:
 *   - support_requests: a shop can file and read its own, but only a
 *     platform admin can change a ticket's status.
 *   - security_events / payments / platform_notifications / login_attempts:
 *     platform-admin-only, full stop — a shop sees none of it, even its own.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let platformTenantId: string;
let operatorId: string;

type Row = Record<string, any>;

const asShop = <T>(fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop, role = "shop_admin") =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

const asOperator = <T>(fn: Parameters<typeof asTenant<T>>[2]) =>
  asTenant(app(), { tenantId: platformTenantId, userId: operatorId, isPlatformAdmin: true }, fn);

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("pc-shop", "pc-other");
  await owner()`DELETE FROM grip.tenants WHERE slug = 'pc-platform'`;

  shop = await createShop("pc-shop");
  other = await createShop("pc-other");

  const [platformTenant] = await owner()<Row[]>`
    INSERT INTO grip.tenants (name, slug, plan, status)
    VALUES ('Test Platform', 'pc-platform', 'internal', 'active') RETURNING id`;
  platformTenantId = platformTenant.id;
  const [opUser] = await owner()<Row[]>`
    INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
    VALUES (${platformTenantId}, 'operator@pc-platform.test', 'x', 'Operator', 'shop_admin')
    RETURNING id`;
  operatorId = opUser.id;
  await owner()`INSERT INTO grip.platform_admins (user_id) VALUES (${operatorId})`;
});

afterAll(async () => {
  await dropShops("pc-shop", "pc-other", "pc-platform");
  await closeAll();
});

beforeEach(async () => {
  await owner()`DELETE FROM grip.support_requests WHERE tenant_id IN (${shop.tenantId}, ${other.tenantId})`;
  await owner()`DELETE FROM grip.security_events`;
  await owner()`DELETE FROM grip.login_attempts`;
  await owner()`DELETE FROM grip.payments`;
  await owner()`DELETE FROM grip.platform_notifications`;
  // Role-change tests mutate real rows on the fixture; reset so test order
  // never matters (same pattern as administration.test.ts's beforeEach).
  await owner()`UPDATE grip.users SET is_active = true, role = split_part(email, '@', 1)::grip.user_role
                WHERE tenant_id IN (${shop.tenantId}, ${other.tenantId})`;
});

describe("support requests", () => {
  test("a shop can file one, and it rings the operator's bell", async () => {
    const [{ create_support_request: id }] = await asShop(
      (tx) => tx<Row[]>`SELECT grip.create_support_request('Printer jam', 'The invoice printer is jammed again.')`,
    );
    expect(id).toBeTruthy();

    const [stored] = await owner()<Row[]>`SELECT tenant_id, status FROM grip.support_requests WHERE id = ${id}`;
    expect(stored.tenant_id).toBe(shop.tenantId);
    expect(stored.status).toBe("open");

    const [note] = await owner()<Row[]>`
      SELECT kind, tenant_id, is_read FROM grip.platform_notifications WHERE support_request_id = ${id}`;
    expect(note.kind).toBe("support_request");
    expect(note.tenant_id).toBe(shop.tenantId);
    expect(note.is_read).toBe(false);
  });

  test("a shop sees only its own tickets", async () => {
    await asShop((tx) => tx`SELECT grip.create_support_request('Mine', 'x')`, shop);
    await asShop((tx) => tx`SELECT grip.create_support_request('Theirs', 'x')`, other);

    const mine = await asShop((tx) => tx<Row[]>`SELECT subject FROM grip.support_requests`, shop);
    expect(mine.map((r) => r.subject)).toEqual(["Mine"]);
  });

  test("the operator sees every shop's tickets", async () => {
    await asShop((tx) => tx`SELECT grip.create_support_request('Mine', 'x')`, shop);
    await asShop((tx) => tx`SELECT grip.create_support_request('Theirs', 'x')`, other);

    const all = await asOperator((tx) => tx<Row[]>`SELECT subject FROM grip.support_requests ORDER BY subject`);
    expect(all.map((r) => r.subject)).toEqual(["Mine", "Theirs"]);
  });

  test("a shop cannot resolve its own ticket", async () => {
    const [{ create_support_request: id }] = await asShop(
      (tx) => tx<Row[]>`SELECT grip.create_support_request('Help', 'x')`,
    );
    await expect(
      asShop((tx) => tx`SELECT grip.set_support_request_status(${id}, 'resolved')`),
    ).rejects.toThrow(/only the operator/);
  });

  test("the operator can resolve a ticket, which clears from the open list", async () => {
    const [{ create_support_request: id }] = await asShop(
      (tx) => tx<Row[]>`SELECT grip.create_support_request('Help', 'x')`,
    );
    await asOperator((tx) => tx`SELECT grip.set_support_request_status(${id}, 'resolved')`);

    const [row] = await owner()<Row[]>`SELECT status, resolved_at FROM grip.support_requests WHERE id = ${id}`;
    expect(row.status).toBe("resolved");
    expect(row.resolved_at).toBeTruthy();
  });
});

describe("security events and login attempts — operator-only", () => {
  test("a shop cannot read security events, even its own", async () => {
    await owner()`INSERT INTO grip.security_events (tenant_id, kind, details)
                  VALUES (${shop.tenantId}, 'failed_logins', '{}'::jsonb)`;
    const rows = await asShop((tx) => tx<Row[]>`SELECT * FROM grip.security_events`);
    expect(rows).toHaveLength(0);
  });

  test("the operator sees it", async () => {
    await owner()`INSERT INTO grip.security_events (tenant_id, kind, details)
                  VALUES (${shop.tenantId}, 'failed_logins', '{}'::jsonb)`;
    const rows = await asOperator((tx) => tx<Row[]>`SELECT * FROM grip.security_events`);
    expect(rows).toHaveLength(1);
  });

  test("record_login_attempt counts consecutive failures and resets on success", async () => {
    const email = "flaky@pc-shop.test";
    for (let i = 0; i < 4; i++) {
      const [{ record_login_attempt: n }] = await owner()<Row[]>`
        SELECT grip.record_login_attempt(${email}, ${shop.tenantId}, false)`;
      expect(n).toBe(i + 1);
    }
    const [{ record_login_attempt: afterSuccess }] = await owner()<Row[]>`
      SELECT grip.record_login_attempt(${email}, ${shop.tenantId}, true)`;
    expect(afterSuccess).toBe(0);

    const [{ record_login_attempt: freshFailure }] = await owner()<Row[]>`
      SELECT grip.record_login_attempt(${email}, ${shop.tenantId}, false)`;
    expect(freshFailure).toBe(1);
  });

  test("log_security_event writes the event and a notification together", async () => {
    const [{ log_security_event: eventId }] = await owner()<Row[]>`
      SELECT grip.log_security_event('failed_logins', ${shop.tenantId}, NULL, '{"email":"x"}'::jsonb,
        'Too many failed logins', 'details here')`;
    expect(eventId).toBeTruthy();

    const [note] = await owner()<Row[]>`
      SELECT kind, title FROM grip.platform_notifications WHERE security_event_id = ${eventId}`;
    expect(note.kind).toBe("security_event");
    expect(note.title).toBe("Too many failed logins");
  });

  test("promoting a login to shop_admin raises a security event and returns a notification to send", async () => {
    const targetId = other.users.service_advisor;
    const [result] = await asShop(
      (tx) => tx<Row[]>`SELECT * FROM grip.update_user_access(${targetId}, 'shop_admin', true)`,
      other,
    );
    expect(result.notify_title).toMatch(/new shop admin/i);

    const [event] = await owner()<Row[]>`
      SELECT kind, tenant_id FROM grip.security_events WHERE tenant_id = ${other.tenantId}`;
    expect(event.kind).toBe("privilege_grant");
  });

  test("a role change that is not a promotion to shop_admin raises nothing", async () => {
    const targetId = other.users.service_advisor;
    const [result] = await asShop(
      (tx) => tx<Row[]>`SELECT * FROM grip.update_user_access(${targetId}, 'parts_advisor', true)`,
      other,
    );
    expect(result.notify_title).toBeNull();

    const [event] = await owner()<Row[]>`
      SELECT 1 FROM grip.security_events WHERE tenant_id = ${other.tenantId}`;
    expect(event).toBeUndefined();
  });

  test("granting platform_admin directly is caught by the trigger", async () => {
    const targetId = other.users.shop_admin;
    await owner()`INSERT INTO grip.platform_admins (user_id) VALUES (${targetId})`;

    const [event] = await owner()<Row[]>`
      SELECT kind, user_id FROM grip.security_events WHERE user_id = ${targetId}`;
    expect(event.kind).toBe("privilege_grant");

    await owner()`DELETE FROM grip.platform_admins WHERE user_id = ${targetId}`;
  });
});

describe("payments — operator-only", () => {
  test("a shop cannot see its own payments", async () => {
    await owner()`INSERT INTO grip.payments (tenant_id, amount, status) VALUES (${shop.tenantId}, 200, 'due')`;
    const rows = await asShop((tx) => tx<Row[]>`SELECT * FROM grip.payments`);
    expect(rows).toHaveLength(0);
  });

  test("a shop cannot insert a payment for itself", async () => {
    await expect(
      asShop((tx) => tx`INSERT INTO grip.payments (tenant_id, amount, status) VALUES (${shop.tenantId}, 200, 'due')`),
    ).rejects.toThrow();
  });

  test("the operator can record and read payments across shops", async () => {
    await asOperator(
      (tx) => tx`INSERT INTO grip.payments (tenant_id, amount, status) VALUES (${shop.tenantId}, 200, 'due')`,
    );
    const rows = await asOperator((tx) => tx<Row[]>`SELECT amount, status FROM grip.payments`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(200);
  });
});

describe("notifications", () => {
  test("mark_notification_read and mark_all_notifications_read are operator-only in effect", async () => {
    const [{ create_support_request: id }] = await asShop(
      (tx) => tx<Row[]>`SELECT grip.create_support_request('Help', 'x')`,
    );
    const [note] = await owner()<Row[]>`SELECT id FROM grip.platform_notifications WHERE support_request_id = ${id}`;

    // A shop cannot even see the row to mark it — the UPDATE affects zero rows, no error.
    await asShop((tx) => tx`SELECT grip.mark_notification_read(${note.id})`);
    const [stillUnread] = await owner()<Row[]>`SELECT is_read FROM grip.platform_notifications WHERE id = ${note.id}`;
    expect(stillUnread.is_read).toBe(false);

    await asOperator((tx) => tx`SELECT grip.mark_notification_read(${note.id})`);
    const [nowRead] = await owner()<Row[]>`SELECT is_read, read_at FROM grip.platform_notifications WHERE id = ${note.id}`;
    expect(nowRead.is_read).toBe(true);
    expect(nowRead.read_at).toBeTruthy();
  });

  test("mark_all_notifications_read clears every unread row", async () => {
    await asShop((tx) => tx`SELECT grip.create_support_request('One', 'x')`);
    await asShop((tx) => tx`SELECT grip.create_support_request('Two', 'x')`);

    await asOperator((tx) => tx`SELECT grip.mark_all_notifications_read()`);
    const [{ count }] = await owner()<Row[]>`SELECT count(*) FROM grip.platform_notifications WHERE NOT is_read`;
    expect(Number(count)).toBe(0);
  });
});
