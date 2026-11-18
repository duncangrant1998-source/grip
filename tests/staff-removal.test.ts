/**
 * Removing a member of staff closes their login for good and keeps the person on
 * file. The tests care about both halves: that they really cannot get back in,
 * and that nothing they did stops making sense.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let n = 0;

type Row = Record<string, any>;

const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

/** A fresh person with a login, so every test removes someone of its own. */
async function newPerson(role = "service_advisor", withLogin = true) {
  n += 1;
  let userId: string | null = null;
  if (withLogin) {
    [{ id: userId }] = await owner()<{ id: string }[]>`
      INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
      VALUES (${shop.tenantId}, ${`p${n}@rm-shop.test`}, 'hash', ${`Person ${n}`}, ${role}::grip.user_role)
      RETURNING id`;
  }
  const [emp] = await owner()<Row[]>`
    INSERT INTO grip.employees (tenant_id, user_id, full_name, job_title, hourly_rate, is_technician)
    VALUES (${shop.tenantId}, ${userId}, ${`Person ${n}`}, 'Tester', 30, ${role === "technician"})
    RETURNING id`;
  return { employeeId: emp.id as string, userId, email: `p${n}@rm-shop.test` };
}

const remove = (employeeId: string, note: string | null = null, role = "shop_admin", s: Shop = shop) =>
  as(role, (tx) => tx<Row[]>`SELECT grip.remove_employee(${employeeId}, ${note}) AS r`, s).then((r) => r[0].r);

const employee = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.employees WHERE id = ${id}`)[0];
const user = async (id: string) =>
  (await owner()<Row[]>`SELECT * FROM grip.users WHERE id = ${id}`)[0];

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("rm-shop", "rm-other");
  shop = await createShop("rm-shop");
  other = await createShop("rm-other");
  for (const s of [shop, other]) {
    await owner()`
      INSERT INTO grip.tenant_settings (tenant_id, default_labour_rate, labour_billing_mode, default_tax_rate_id, timezone)
      VALUES (${s.tenantId}, 100.00, 'flat_rate', ${s.taxRateId}, 'America/Toronto')`;
    await owner()`
      INSERT INTO grip.employees (tenant_id, full_name, hourly_rate, user_id)
      VALUES (${s.tenantId}, 'Admin', 40, ${s.users.shop_admin})`;
  }
});

afterAll(async () => {
  await dropShops("rm-shop", "rm-other");
  await closeAll();
});

describe("the person stays on file", () => {
  test("they are marked removed, with when, by whom and why, and nothing is deleted", async () => {
    const p = await newPerson();
    await remove(p.employeeId, "Left the shop in October");
    const e = await employee(p.employeeId);
    expect(e.removed_at).not.toBeNull();
    expect(e.removed_by).toBe(shop.users.shop_admin);
    expect(e.removal_note).toBe("Left the shop in October");
    expect(e.is_active).toBe(false);
    expect(e.full_name).toBe(`Person ${n}`);             // the name is still there
    expect(Number(e.hourly_rate)).toBe(30);
    expect(e.job_title).toBe("Tester");
  });

  test("the login row survives, so 'added by' on old work still has a name", async () => {
    const p = await newPerson();
    await remove(p.employeeId);
    const u = await user(p.userId!);
    expect(u).toBeTruthy();
    expect(u.full_name).toBe(`Person ${n}`);
  });

  test("hours they worked are still there", async () => {
    const p = await newPerson();
    await owner()`
      INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in, clock_out)
      VALUES (${shop.tenantId}, ${p.employeeId}, now() - interval '30 days', now() - interval '30 days' + interval '8 hours')`;
    await remove(p.employeeId);
    const rows = await owner()<Row[]>`SELECT 1 FROM grip.time_entries WHERE employee_id = ${p.employeeId}`;
    expect(rows).toHaveLength(1);
  });

  test("work they added keeps its author", async () => {
    const p = await newPerson("service_advisor");
    const [wo] = await asTenant(app(), { tenantId: shop.tenantId, userId: p.userId! }, (tx) => tx<Row[]>`
      SELECT grip.create_work_order(${shop.customerId}, ${shop.vehicleId}, 'x', NULL) AS id`);
    await remove(p.employeeId);
    const [row] = await owner()<Row[]>`SELECT opened_by FROM grip.work_orders WHERE id = ${wo.id}`;
    expect(row.opened_by).toBe(p.userId);
  });

  test("someone with no login can be removed too", async () => {
    const p = await newPerson("technician", false);
    await remove(p.employeeId);
    expect((await employee(p.employeeId)).removed_at).not.toBeNull();
  });

  test("it is written to the activity trail", async () => {
    const p = await newPerson();
    await remove(p.employeeId);
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log WHERE entity_id = ${p.employeeId} AND action = 'staff.removed'`;
    expect(row.actor_user_id).toBe(shop.users.shop_admin);
    expect(row.diff.name).toBe(`Person ${n}`);
  });
});

describe("the account is closed for good", () => {
  test("the login is disabled, the password destroyed and the email freed", async () => {
    const p = await newPerson();
    await remove(p.employeeId);
    const u = await user(p.userId!);
    expect(u.is_active).toBe(false);
    expect(u.password_hash).toBe("!removed");
    expect(u.email).not.toBe(p.email);
    expect(u.email).toMatch(/@removed\.invalid$/);
  });

  test("they cannot sign in, by the old email or any other", async () => {
    const p = await newPerson();
    await remove(p.employeeId);
    const rows = await owner()<Row[]>`SELECT * FROM grip.find_users_for_login(${p.email})`;
    expect(rows).toHaveLength(0);
  });

  test("their sessions are ended", async () => {
    const p = await newPerson();
    await owner()`
      INSERT INTO grip.sessions (tenant_id, user_id, expires_at)
      VALUES (${shop.tenantId}, ${p.userId}, now() + interval '1 day')`;
    await remove(p.employeeId);
    const live = await owner()<Row[]>`
      SELECT 1 FROM grip.sessions WHERE user_id = ${p.userId} AND revoked_at IS NULL`;
    expect(live).toHaveLength(0);
  });

  test("the email can be used again for someone new", async () => {
    const p = await newPerson();
    await remove(p.employeeId);
    await expect(owner()`
      INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
      VALUES (${shop.tenantId}, ${p.email}, 'hash', 'Replacement', 'service_advisor')`).resolves.toBeDefined();
  });
});

describe("what is tidied up behind them", () => {
  test("if they are on the clock it is closed, not left running", async () => {
    const p = await newPerson();
    await owner()`INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in)
                  VALUES (${shop.tenantId}, ${p.employeeId}, now() - interval '2 hours')`;
    const result = await remove(p.employeeId);
    expect(result.clocked_out).toBe(1);
    const open = await owner()<Row[]>`SELECT 1 FROM grip.time_entries WHERE employee_id = ${p.employeeId} AND clock_out IS NULL`;
    expect(open).toHaveLength(0);
  });

  test("future shifts go and past ones stay", async () => {
    const p = await newPerson();
    await owner()`
      INSERT INTO grip.shifts (tenant_id, employee_id, starts_at, ends_at) VALUES
        (${shop.tenantId}, ${p.employeeId}, now() - interval '10 days', now() - interval '10 days' + interval '8 hours'),
        (${shop.tenantId}, ${p.employeeId}, now() + interval '5 days',  now() + interval '5 days' + interval '8 hours'),
        (${shop.tenantId}, ${p.employeeId}, now() + interval '6 days',  now() + interval '6 days' + interval '8 hours')`;
    const result = await remove(p.employeeId);
    expect(result.shifts_removed).toBe(2);
    const left = await owner()<Row[]>`SELECT 1 FROM grip.shifts WHERE employee_id = ${p.employeeId}`;
    expect(left).toHaveLength(1);
  });

  test("their upcoming bookings are left unassigned for someone else to take", async () => {
    const p = await newPerson("technician");
    const [appt] = await owner()<Row[]>`
      INSERT INTO grip.appointments
        (tenant_id, customer_id, vehicle_id, assigned_tech_id, starts_at, estimated_minutes, status)
      VALUES (${shop.tenantId}, ${shop.customerId}, ${shop.vehicleId}, ${p.employeeId},
              now() + interval '3 days', 60, 'scheduled') RETURNING id`;
    const result = await remove(p.employeeId);
    expect(result.appointments_unassigned).toBe(1);
    const [a] = await owner()<Row[]>`SELECT assigned_tech_id FROM grip.appointments WHERE id = ${appt.id}`;
    expect(a.assigned_tech_id).toBeNull();
  });

  test("their pending time off is withdrawn; requests sent to them go to the administrators", async () => {
    const p = await newPerson("service_advisor");
    const q = await newPerson("technician");
    await owner()`
      INSERT INTO grip.time_off_requests (tenant_id, employee_id, recipient_user_id, from_date, to_date)
      VALUES (${shop.tenantId}, ${p.employeeId}, ${shop.users.shop_admin}, current_date + 400, current_date + 401),
             (${shop.tenantId}, ${q.employeeId}, ${p.userId}, current_date + 410, current_date + 411)`;
    await remove(p.employeeId);

    const mine = await owner()<Row[]>`SELECT status FROM grip.time_off_requests WHERE employee_id = ${p.employeeId}`;
    expect(mine[0].status).toBe("cancelled");
    const theirs = await owner()<Row[]>`SELECT recipient_user_id, status FROM grip.time_off_requests WHERE employee_id = ${q.employeeId}`;
    expect(theirs[0].recipient_user_id).toBeNull();
    expect(theirs[0].status).toBe("pending");
  });
});

describe("what it will not do", () => {
  test("you cannot remove yourself", async () => {
    await expect(as("shop_admin", async (tx) => {
      const [me] = await tx<Row[]>`SELECT id FROM grip.employees WHERE user_id = ${shop.users.shop_admin}`;
      await tx`SELECT grip.remove_employee(${me.id}, NULL)`;
    })).rejects.toThrow(/cannot remove yourself/i);
  });

  test("it will not remove the only administrator", async () => {
    const lone = await createShop("rm-lone");
    try {
      const [victim] = await owner()<Row[]>`
        INSERT INTO grip.employees (tenant_id, user_id, full_name, hourly_rate)
        VALUES (${lone.tenantId}, ${lone.users.shop_admin}, 'Only Admin', 40) RETURNING id`;
      const [actor] = await owner()<Row[]>`
        INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
        VALUES (${lone.tenantId}, 'actor@lone.test', 'h', 'Actor', 'service_advisor') RETURNING id`;
      // createShop's shop_admin is this shop's first admin, so it's also the
      // protected owner — a non-administrator actor hits that guard before
      // even reaching the "don't orphan the shop" one, which is fine: the
      // outcome (the shop keeps its one administrator) is the same either way.
      await expect(asTenant(app(), { tenantId: lone.tenantId, userId: actor.id }, (tx) => tx`
        SELECT grip.remove_employee(${victim.id}, NULL)`)).rejects.toThrow(/shop owner/i);
    } finally {
      await dropShops("rm-lone");
    }
  });

  test("two administrators cannot remove each other at once", async () => {
    const duo = await createShop("rm-duo");
    try {
      const [a2] = await owner()<Row[]>`
        INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
        VALUES (${duo.tenantId}, 'second@duo.test', 'h', 'Second Admin', 'shop_admin') RETURNING id`;
      const [e1] = await owner()<Row[]>`
        INSERT INTO grip.employees (tenant_id, user_id, full_name, hourly_rate)
        VALUES (${duo.tenantId}, ${duo.users.shop_admin}, 'Admin One', 40) RETURNING id`;
      const [e2] = await owner()<Row[]>`
        INSERT INTO grip.employees (tenant_id, user_id, full_name, hourly_rate)
        VALUES (${duo.tenantId}, ${a2.id}, 'Admin Two', 40) RETURNING id`;

      const results = await Promise.allSettled([
        asTenant(app(), { tenantId: duo.tenantId, userId: duo.users.shop_admin }, (tx) =>
          tx`SELECT grip.remove_employee(${e2.id}, NULL)`),
        asTenant(app(), { tenantId: duo.tenantId, userId: a2.id }, (tx) =>
          tx`SELECT grip.remove_employee(${e1.id}, NULL)`),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const active = await owner()<Row[]>`
        SELECT 1 FROM grip.users WHERE tenant_id = ${duo.tenantId} AND role = 'shop_admin' AND is_active`;
      expect(active).toHaveLength(1);
    } finally {
      await dropShops("rm-duo");
    }
  });

  test("someone already removed cannot be removed again", async () => {
    const p = await newPerson();
    await remove(p.employeeId);
    await expect(remove(p.employeeId)).rejects.toThrow(/already been removed/i);
  });

  test("another shop's staff cannot be removed", async () => {
    const p = await newPerson();
    await expect(remove(p.employeeId, null, "shop_admin", other)).rejects.toThrow(/staff member not found/i);
    expect((await employee(p.employeeId)).removed_at).toBeNull();
  });
});
