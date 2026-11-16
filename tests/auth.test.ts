/**
 * The pre-authentication SECURITY DEFINER functions. These deliberately run
 * outside any tenant scope, so they are the part of the system most worth
 * attacking: they must reveal only what login needs and nothing more.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let a: Shop;
let b: Shop;

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("auth-a", "auth-b");
  a = await createShop("auth-a");
  b = await createShop("auth-b");

  // The same mechanic works at both shops.
  await owner()`
    INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
    VALUES (${a.tenantId}, 'shared@mechanic.test', 'x', 'Shared Mech', 'technician'),
           (${b.tenantId}, 'SHARED@mechanic.test', 'x', 'Shared Mech', 'technician')`;
});

afterAll(async () => {
  await dropShops("auth-a", "auth-b");
  await closeAll();
});

const lookup = (email: string) =>
  app().begin((tx) => tx<{ tenant_slug: string; role: string }[]>`
    SELECT tenant_slug, role FROM grip.find_users_for_login(${email})`);

describe("find_users_for_login", () => {
  test("matches email case-insensitively", async () => {
    const rows = await lookup("Service_Advisor@AUTH-A.test");
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_slug).toBe("auth-a");
  });

  test("returns one row per shop when the same email exists at two", async () => {
    const rows = await lookup("shared@mechanic.test");
    expect(rows.map((r) => r.tenant_slug).sort()).toEqual(["auth-a", "auth-b"]);
  });

  test("returns nothing for an unknown email", async () => {
    expect(await lookup("nobody@nowhere.test")).toHaveLength(0);
  });

  test("hides deactivated users", async () => {
    await owner()`UPDATE grip.users SET is_active = false
                  WHERE tenant_id = ${a.tenantId} AND role = 'technician' AND email = ${"technician@auth-a.test"}`;
    expect(await lookup("technician@auth-a.test")).toHaveLength(0);
  });

  test("hides users of cancelled shops", async () => {
    await owner()`UPDATE grip.tenants SET status = 'cancelled' WHERE id = ${b.tenantId}`;
    expect(await lookup("parts_advisor@auth-b.test")).toHaveLength(0);
    await owner()`UPDATE grip.tenants SET status = 'active' WHERE id = ${b.tenantId}`;
  });

  test("the app role still cannot read users directly without a tenant", async () => {
    // The functions are the ONLY door. The table itself stays locked.
    await expect(
      app().begin((tx) => tx`SELECT email FROM grip.users`),
    ).rejects.toThrow(/app\.tenant_id is not set/i);
  });
});

describe("sessions", () => {
  const userA = () => a.users.service_advisor;

  test("a created session resolves to the right user, shop and role", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<{ create_session: string }[]>`SELECT grip.create_session(${userA()}, 7, 'vitest')`);

    const [row] = await app().begin((tx) => tx<
      { user_id: string; tenant_id: string; role: string; is_platform_admin: boolean }[]
    >`SELECT * FROM grip.resolve_session(${sid})`);

    expect(row.user_id).toBe(userA());
    expect(row.tenant_id).toBe(a.tenantId);
    expect(row.role).toBe("service_advisor");
    expect(row.is_platform_admin).toBe(false);
  });

  test("a revoked session stops resolving immediately", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<{ create_session: string }[]>`SELECT grip.create_session(${userA()}, 7, NULL)`);
    await app().begin((tx) => tx`SELECT grip.revoke_session(${sid})`);

    const rows = await app().begin((tx) => tx`SELECT * FROM grip.resolve_session(${sid})`);
    expect(rows).toHaveLength(0);
  });

  test("an expired session does not resolve", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<{ create_session: string }[]>`SELECT grip.create_session(${userA()}, 7, NULL)`);
    await owner()`UPDATE grip.sessions SET expires_at = now() - interval '1 minute' WHERE id = ${sid}`;

    const rows = await app().begin((tx) => tx`SELECT * FROM grip.resolve_session(${sid})`);
    expect(rows).toHaveLength(0);
  });

  test("deactivating a user kills their live sessions", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<{ create_session: string }[]>`SELECT grip.create_session(${a.users.parts_advisor}, 7, NULL)`);
    await owner()`UPDATE grip.users SET is_active = false WHERE id = ${a.users.parts_advisor}`;

    const rows = await app().begin((tx) => tx`SELECT * FROM grip.resolve_session(${sid})`);
    expect(rows).toHaveLength(0);
  });

  test("cannot create a session for an inactive or unknown user", async () => {
    await expect(
      app().begin((tx) => tx`SELECT grip.create_session(${a.users.parts_advisor}, 7, NULL)`),
    ).rejects.toThrow(/unknown or inactive/i);
    await expect(
      app().begin((tx) => tx`SELECT grip.create_session(gen_random_uuid(), 7, NULL)`),
    ).rejects.toThrow(/unknown or inactive/i);
  });

  test("an unknown session id resolves to nothing", async () => {
    const rows = await app().begin((tx) =>
      tx`SELECT * FROM grip.resolve_session(gen_random_uuid())`);
    expect(rows).toHaveLength(0);
  });

  test("a shop cannot read another shop's sessions table", async () => {
    await app().begin((tx) =>
      tx`SELECT grip.create_session(${b.users.service_advisor}, 7, NULL)`);

    const visible = await asTenant(
      app(), { tenantId: a.tenantId, userId: a.users.shop_admin },
      (tx) => tx<{ tenant_id: string }[]>`SELECT tenant_id FROM grip.sessions`,
    );
    for (const r of visible) expect(r.tenant_id).toBe(a.tenantId);
  });
});

describe("platform admin flag", () => {
  test("is false for ordinary users and true only with a platform_admins row", async () => {
    await owner()`INSERT INTO grip.platform_admins (user_id) VALUES (${a.users.shop_admin})`;

    const flag = async (userId: string) => {
      const [{ create_session: sid }] = await app().begin((tx) =>
        tx<{ create_session: string }[]>`SELECT grip.create_session(${userId}, 1, NULL)`);
      const [r] = await app().begin((tx) =>
        tx<{ is_platform_admin: boolean }[]>`SELECT is_platform_admin FROM grip.resolve_session(${sid})`);
      return r.is_platform_admin;
    };

    expect(await flag(a.users.shop_admin)).toBe(true);
    expect(await flag(b.users.shop_admin)).toBe(false);
  });
});
