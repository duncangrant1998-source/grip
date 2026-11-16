/**
 * Time-off requests: asked of an administrator or of someone chosen, answered
 * by them (or any administrator), never by the person asking, and never two
 * for the same days.
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

// Each test takes a fresh stretch of days, so requests never collide by accident.
let week = 0;
const slot = (lengthDays = 3) => {
  week += 1;
  const month = String(((week - 1) % 12) + 1).padStart(2, "0");
  const year = 2031 + Math.floor((week - 1) / 12);
  const d = (n: number) => `${year}-${month}-${String(n).padStart(2, "0")}`;
  return { from: d(10), to: d(10 + lengthDays - 1) };
};

const ask = (role: string, from: string, to: string, note: string | null = "Family wedding", recipient: string | null = null, s: Shop = shop) =>
  as(role, (tx) => tx<Row[]>`
    SELECT grip.request_time_off(${from}::date, ${to}::date, ${note}, ${recipient}) AS id`, s)
    .then((r) => r[0].id as string);

const reqOf = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.time_off_requests WHERE id = ${id}`)[0];

const decide = (role: string, id: string, approve: boolean, note: string | null = null) =>
  as(role, (tx) => tx`SELECT grip.decide_time_off(${id}, ${approve}, ${note})`);

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("to-shop", "to-other");
  shop = await createShop("to-shop");
  other = await createShop("to-other");

  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
    for (const role of ["service_advisor", "technician", "parts_advisor", "shop_admin"]) {
      await owner()`
        INSERT INTO grip.employees (tenant_id, full_name, hourly_rate, user_id)
        VALUES (${s.tenantId}, ${role}, 30, ${s.users[role]})`;
    }
  }
});

afterAll(async () => {
  await dropShops("to-shop", "to-other");
  await closeAll();
});

describe("asking", () => {
  test("lands with the shop administrator when nobody is chosen", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    const r = await reqOf(id);
    expect(r.status).toBe("pending");
    expect(r.recipient_user_id).toBe(shop.users.shop_admin);
    expect(r.note).toBe("Family wedding");
  });

  test("or with whoever is chosen", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to, "Dentist", shop.users.service_advisor);
    expect((await reqOf(id)).recipient_user_id).toBe(shop.users.service_advisor);
  });

  test("a single day is a request of one day", async () => {
    const { from } = slot();
    const id = await ask("technician", from, from);
    const r = await reqOf(id);
    expect(r.from_date).toEqual(r.to_date);
  });

  test("the note is optional", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to, "   ");
    expect((await reqOf(id)).note).toBeNull();
  });

  test("the last day cannot be before the first", async () => {
    await expect(ask("technician", "2031-03-10", "2031-03-09")).rejects.toThrow(/cannot be before/i);
  });

  test("days already gone are refused", async () => {
    await expect(ask("technician", "2020-01-01", "2020-01-02")).rejects.toThrow(/already passed/i);
  });

  test("a request longer than 90 days is refused", async () => {
    await expect(ask("technician", "2031-01-01", "2031-06-01")).rejects.toThrow(/at most 90 days/i);
  });

  test("cannot be sent to yourself", async () => {
    const { from, to } = slot();
    await expect(ask("technician", from, to, "x", shop.users.technician)).rejects.toThrow(/someone else/i);
  });

  test("cannot be sent to someone in another shop", async () => {
    const { from, to } = slot();
    await expect(ask("technician", from, to, "x", other.users.shop_admin)).rejects.toThrow(/not found/i);
  });

  test("a login with no staff record cannot ask", async () => {
    const [u] = await owner()<Row[]>`
      INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
      VALUES (${shop.tenantId}, 'norecord@to-shop.test', 'x', 'No Record', 'service_advisor') RETURNING id`;
    const { from, to } = slot();
    await expect(asTenant(app(), { tenantId: shop.tenantId, userId: u.id }, (tx) => tx`
      SELECT grip.request_time_off(${from}::date, ${to}::date, 'x', NULL)`))
      .rejects.toThrow(/not linked to a staff record/i);
  });
});

describe("overlapping requests", () => {
  test("a second request for the same days is refused", async () => {
    const { from, to } = slot(5);
    await ask("technician", from, to);
    await expect(ask("technician", from, to)).rejects.toThrow();
  });

  test("so is one that merely overlaps", async () => {
    const { from, to } = slot(5);
    await ask("technician", from, to);
    const overlapStart = to;
    await expect(ask("technician", overlapStart, overlapStart)).rejects.toThrow();
  });

  test("two different people can take the same days off", async () => {
    const { from, to } = slot();
    await ask("technician", from, to);
    await expect(ask("service_advisor", from, to)).resolves.toBeTruthy();
  });

  test("a declined request frees the days up", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await decide("shop_admin", id, false);
    await expect(ask("technician", from, to)).resolves.toBeTruthy();
  });

  test("so does a withdrawn one", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await as("technician", (tx) => tx`SELECT grip.cancel_time_off(${id})`);
    await expect(ask("technician", from, to)).resolves.toBeTruthy();
  });

  test("an approved one does not", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await decide("shop_admin", id, true);
    await expect(ask("technician", from, to)).rejects.toThrow();
  });
});

describe("answering", () => {
  test("the person it was sent to can approve, with a reply", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to, "x", shop.users.service_advisor);
    await decide("service_advisor", id, true, "Enjoy!");
    const r = await reqOf(id);
    expect(r.status).toBe("approved");
    expect(r.decided_by).toBe(shop.users.service_advisor);
    expect(r.decision_note).toBe("Enjoy!");
    expect(r.decided_at).not.toBeNull();
  });

  test("or decline", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await decide("shop_admin", id, false, "We're short that week.");
    const r = await reqOf(id);
    expect(r.status).toBe("declined");
    expect(r.decision_note).toBe("We're short that week.");
  });

  test("any administrator can answer one sent to someone else", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to, "x", shop.users.service_advisor);
    await decide("shop_admin", id, true);
    expect((await reqOf(id)).status).toBe("approved");
  });

  test("someone it was not sent to, who is not an administrator, cannot", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to, "x", shop.users.service_advisor);
    await expect(decide("parts_advisor", id, true)).rejects.toThrow(/not sent to you/i);
    expect((await reqOf(id)).status).toBe("pending");
  });

  test("nobody answers their own request, administrator or not", async () => {
    const { from, to } = slot();
    const id = await ask("shop_admin", from, to, "x", shop.users.service_advisor);
    await expect(decide("shop_admin", id, true)).rejects.toThrow(/own request/i);
  });

  test("a request can only be answered once", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await decide("shop_admin", id, true);
    await expect(decide("shop_admin", id, false)).rejects.toThrow(/already been approved/i);
  });

  test("the answer is written to the activity trail", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await decide("shop_admin", id, true);
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id FROM grip.audit_log WHERE entity_id = ${id} AND action = 'time_off.approved'`;
    expect(row.actor_user_id).toBe(shop.users.shop_admin);
  });
});

describe("withdrawing", () => {
  test("only the person who asked, and only while it is pending", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    await expect(as("service_advisor", (tx) => tx`SELECT grip.cancel_time_off(${id})`))
      .rejects.toThrow(/only withdraw your own/i);

    await decide("shop_admin", id, true);
    await expect(as("technician", (tx) => tx`SELECT grip.cancel_time_off(${id})`))
      .rejects.toThrow(/cannot be withdrawn/i);
  });
});

describe("tenant isolation", () => {
  test("another shop sees none of it and cannot answer it", async () => {
    const { from, to } = slot();
    const id = await ask("technician", from, to);
    const seen = await as("shop_admin", (tx) => tx<Row[]>`SELECT id FROM grip.time_off_requests WHERE id = ${id}`, other);
    expect(seen).toHaveLength(0);
    await expect(as("shop_admin", (tx) => tx`SELECT grip.decide_time_off(${id}, true, NULL)`, other))
      .rejects.toThrow(/request not found/i);
  });
});
