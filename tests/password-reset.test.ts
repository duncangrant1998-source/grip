/**
 * Self-service password reset (0024): the two SECURITY DEFINER functions
 * that run pre-authentication, same spirit as auth.test.ts.
 */
import { createHash } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { app, owner, assertAppRoleIsRestricted, createShop, closeAll, dropShops, type Shop } from "./helpers";

let a: Shop;
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("reset-a");
  a = await createShop("reset-a");
});

afterAll(async () => {
  await dropShops("reset-a");
  await closeAll();
});

const issue = async (userId: string, ttlMinutes = 30) => {
  const raw = "test-token-" + Math.random().toString(36).slice(2);
  const [{ create_password_reset: issued }] = await app().begin((tx) =>
    tx<{ create_password_reset: boolean }[]>`
      SELECT grip.create_password_reset(${userId}, ${hashToken(raw)}, ${ttlMinutes})`);
  return { raw, issued };
};

describe("create_password_reset", () => {
  test("issues a usable token", async () => {
    const { issued } = await issue(a.users.technician);
    expect(issued).toBe(true);
  });

  test("invalidates a previous unused token for the same user", async () => {
    const first = await issue(a.users.service_advisor);
    await issue(a.users.service_advisor);

    await expect(
      app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken(first.raw)}, 'newhash')`),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  test("stops issuing after five requests in an hour", async () => {
    for (let i = 0; i < 5; i++) await issue(a.users.parts_advisor);
    const { issued } = await issue(a.users.parts_advisor);
    expect(issued).toBe(false);
  });
});

describe("complete_password_reset", () => {
  test("sets the new password hash and consumes the token", async () => {
    const { raw } = await issue(a.users.shop_admin);
    await app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken(raw)}, 'new-hash-123')`);

    const [row] = await owner()<{ password_hash: string }[]>`
      SELECT password_hash FROM grip.users WHERE id = ${a.users.shop_admin}`;
    expect(row.password_hash).toBe("new-hash-123");
  });

  test("the same token cannot be used twice", async () => {
    const { raw } = await issue(a.users.technician);
    await app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken(raw)}, 'first-hash')`);

    await expect(
      app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken(raw)}, 'second-hash')`),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  test("an expired token is rejected", async () => {
    const { raw } = await issue(a.users.service_advisor, 30);
    await owner()`UPDATE grip.password_resets SET expires_at = now() - interval '1 minute'
                  WHERE token_hash = ${hashToken(raw)}`;

    await expect(
      app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken(raw)}, 'x')`),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  test("an unknown token is rejected", async () => {
    await expect(
      app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken("nope")}, 'x')`),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  test("revokes the account's live sessions", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<{ create_session: string }[]>`SELECT grip.create_session(${a.users.parts_advisor}, 7, NULL)`);

    const { raw } = await issue(a.users.parts_advisor);
    await app().begin((tx) => tx`SELECT grip.complete_password_reset(${hashToken(raw)}, 'fresh-hash')`);

    const rows = await app().begin((tx) => tx`SELECT * FROM grip.resolve_session(${sid})`);
    expect(rows).toHaveLength(0);
  });
});
