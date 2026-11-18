/**
 * Administration: staff logins, shifts, the time clock, tax rates.
 * (Reports have their own file.)
 */
import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  app, appAlt, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let techEmp: string;
let helperEmp: string;
let otherEmp: string;

type Row = Record<string, any>;
const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("ad-shop", "ad-other");
  shop = await createShop("ad-shop");
  other = await createShop("ad-other");

  await owner()`INSERT INTO grip.tenant_settings (tenant_id, timezone, default_tax_rate_id)
                VALUES (${shop.tenantId}, 'America/Vancouver', ${shop.taxRateId})`;

  const emp = async (s: Shop, name: string, userId: string | null, tech = false, rate = 30) =>
    (await owner()<Row[]>`
      INSERT INTO grip.employees (tenant_id, user_id, full_name, hourly_rate, is_technician)
      VALUES (${s.tenantId}, ${userId}, ${name}, ${rate}, ${tech}) RETURNING id`)[0].id as string;
  techEmp = await emp(shop, "Alex", shop.users.technician, true, 40);
  helperEmp = await emp(shop, "Helper", null);
  otherEmp = await emp(other, "Other Person", other.users.technician, true);
});

afterAll(async () => {
  await dropShops("ad-shop", "ad-other");
  await closeAll();
});

beforeEach(async () => {
  await owner()`DELETE FROM grip.time_entries WHERE tenant_id = ${shop.tenantId}`;
  await owner()`DELETE FROM grip.shifts WHERE tenant_id = ${shop.tenantId}`;
  await owner()`DELETE FROM grip.sessions WHERE tenant_id = ${shop.tenantId}`;
  await owner()`UPDATE grip.users SET is_active = true, role = split_part(email, '@', 1)::grip.user_role
                WHERE tenant_id = ${shop.tenantId}`;
});

// --- staff -------------------------------------------------------------------------

describe("creating a login", () => {
  const create = (email: string, role = "service_advisor") =>
    as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.create_user(${email}, 'New Person', ${role}::grip.user_role, 'hash') AS id`);

  test("stores the email lower-cased inside this shop", async () => {
    const [r] = await create("  New.Person@Shop.TEST ");
    const [u] = await owner()<Row[]>`SELECT email, tenant_id, role FROM grip.users WHERE id = ${r.id}`;
    expect(u.email).toBe("new.person@shop.test");
    expect(u.tenant_id).toBe(shop.tenantId);
    await owner()`DELETE FROM grip.users WHERE id = ${r.id}`;
  });

  test("the same email cannot be used twice in one shop, in any capitalisation", async () => {
    const [r] = await create("dup@shop.test");
    await expect(create("DUP@shop.test")).rejects.toThrow(/duplicate key/i);
    await owner()`DELETE FROM grip.users WHERE id = ${r.id}`;
  });

  test("but another shop can have the same email", async () => {
    const [a] = await create("shared@mechanic.test");
    const [b] = await as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.create_user('shared@mechanic.test', 'Same Person', 'technician', 'hash') AS id`, other);
    expect(a.id).not.toBe(b.id);
    await owner()`DELETE FROM grip.users WHERE id IN (${a.id}, ${b.id})`;
  });

  test("rejects a malformed email and a missing password", async () => {
    await expect(create("not-an-email")).rejects.toThrow(/does not look right/i);
    await expect(as("shop_admin", (tx) => tx`
      SELECT grip.create_user('ok@shop.test', 'X', 'technician', '')`)).rejects.toThrow(/needs a password/i);
  });

  test("is on the audit log", async () => {
    const [r] = await create("audited@shop.test");
    const [a] = await owner()<Row[]>`
      SELECT actor_user_id FROM grip.audit_log WHERE entity_id = ${r.id} AND action = 'user.created'`;
    expect(a.actor_user_id).toBe(shop.users.shop_admin);
    await owner()`DELETE FROM grip.users WHERE id = ${r.id}`;
  });
});

describe("a shop always keeps an administrator", () => {
  const access = (userId: string, role: string, active: boolean, as_ = "shop_admin", s: Shop = shop) =>
    as(as_, (tx) => tx`SELECT grip.update_user_access(${userId}, ${role}::grip.user_role, ${active})`, s);

  // createShop's shop_admin is the shop's very first admin, so it is
  // automatically the protected owner (see "the shop owner" below) — it can
  // never be demoted or deactivated, with or without other admins around.
  // Because of that, this shop always has at least one active administrator
  // (the owner) regardless of what happens to anyone else, so the classic
  // "don't orphan the shop" guard is exercised on the *owner* here — a
  // non-owner admin never gets a chance to be the last one while the owner
  // exists.
  test("the owner cannot be demoted or deactivated — alone, or with other admins active", async () => {
    await expect(access(shop.users.shop_admin, "service_advisor", true)).rejects.toThrow(/shop owner/i);
    await expect(access(shop.users.shop_admin, "shop_admin", false)).rejects.toThrow(/shop owner/i);
  });

  test("still true once there is a second admin", async () => {
    await access(shop.users.service_advisor, "shop_admin", true); // now two admins
    await expect(access(shop.users.shop_admin, "service_advisor", true)).rejects.toThrow(/shop owner/i);
    await expect(access(shop.users.shop_admin, "shop_admin", false)).rejects.toThrow(/shop owner/i);
  });

  test("a non-owner admin can be demoted once there is another active administrator", async () => {
    await access(shop.users.service_advisor, "shop_admin", true); // owner + service_advisor are both admins
    await expect(access(shop.users.service_advisor, "service_advisor", true)).resolves.toBeDefined();
  });

  test("two admins demoting each other at the same instant: exactly one succeeds", async () => {
    await access(shop.users.service_advisor, "shop_admin", true); // now two admins
    const second = appAlt();
    try {
      const demote = (sql: typeof second, actor: string, target: string) =>
        asTenant(sql, { tenantId: shop.tenantId, userId: actor }, async (tx) => {
          await tx`SELECT grip.update_user_access(${target}, 'technician', true)`;
          await tx`SELECT pg_sleep(0.2)`;
        });
      const results = await Promise.allSettled([
        demote(app(), shop.users.shop_admin, shop.users.service_advisor),
        demote(second, shop.users.service_advisor, shop.users.shop_admin),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const [{ n }] = await owner()<Row[]>`
        SELECT count(*)::int AS n FROM grip.users
        WHERE tenant_id = ${shop.tenantId} AND role = 'shop_admin' AND is_active`;
      expect(n).toBe(1);
    } finally {
      await second.end();
    }
  });

  test("deactivating a login ends its live sessions at once", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<Row[]>`SELECT grip.create_session(${shop.users.parts_advisor}, 7, NULL)`);
    await access(shop.users.parts_advisor, "parts_advisor", false);
    const rows = await app().begin((tx) => tx`SELECT * FROM grip.resolve_session(${sid})`);
    expect(rows).toHaveLength(0);
  });

  test("making someone a technician marks their staff record as one", async () => {
    await owner()`UPDATE grip.employees SET is_technician = false WHERE id = ${techEmp}`;
    await access(shop.users.technician, "technician", true);
    const [e] = await owner()<Row[]>`SELECT is_technician FROM grip.employees WHERE id = ${techEmp}`;
    expect(e.is_technician).toBe(true);
  });

  test("another shop cannot change this shop's logins", async () => {
    await expect(access(shop.users.service_advisor, "shop_admin", true, "shop_admin", other))
      .rejects.toThrow(/login not found/i);
  });
});

describe("resetting a password", () => {
  test("changes the hash and signs the person out everywhere", async () => {
    const [{ create_session: sid }] = await app().begin((tx) =>
      tx<Row[]>`SELECT grip.create_session(${shop.users.service_advisor}, 7, NULL)`);
    await as("shop_admin", (tx) => tx`SELECT grip.set_user_password(${shop.users.service_advisor}, 'newhash')`);

    const [u] = await owner()<Row[]>`SELECT password_hash FROM grip.users WHERE id = ${shop.users.service_advisor}`;
    expect(u.password_hash).toBe("newhash");
    expect(await app().begin((tx) => tx`SELECT * FROM grip.resolve_session(${sid})`)).toHaveLength(0);
  });

  test("cannot reset another shop's login", async () => {
    await expect(as("shop_admin", (tx) => tx`SELECT grip.set_user_password(${shop.users.service_advisor}, 'x')`, other))
      .rejects.toThrow(/login not found/i);
  });
});

// --- shifts ------------------------------------------------------------------------

describe("shifts", () => {
  const add = (start: string, end: string, emp = techEmp, s: Shop = shop) =>
    as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.add_shift(${emp}, ${start}::text::timestamp, ${end}::text::timestamp, NULL) AS id`, s);

  test("is stored at the shop's wall-clock time", async () => {
    const [r] = await add("2030-03-12 08:00", "2030-03-12 16:00");
    const [s] = await owner()<Row[]>`
      SELECT to_char(starts_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc FROM grip.shifts WHERE id = ${r.id}`;
    expect(s.utc).toBe("15:00"); // 08:00 PDT
  });

  test("rejects an overlap for the same person, naming it", async () => {
    await add("2030-03-12 08:00", "2030-03-12 16:00");
    await expect(add("2030-03-12 15:00", "2030-03-12 18:00")).rejects.toThrow(/Alex already has a shift 8:00 AM – 4:00 PM/);
  });

  test("a split shift and different people are fine", async () => {
    await add("2030-03-12 08:00", "2030-03-12 12:00");
    await expect(add("2030-03-12 13:00", "2030-03-12 17:00")).resolves.toBeDefined();
    await expect(add("2030-03-12 08:00", "2030-03-12 12:00", helperEmp)).resolves.toBeDefined();
  });

  test("must end after it starts and stay within a day", async () => {
    await expect(add("2030-03-12 16:00", "2030-03-12 08:00")).rejects.toThrow(/end after it starts/i);
    await expect(add("2030-03-12 08:00", "2030-03-14 08:00")).rejects.toThrow(/longer than 24 hours/i);
  });

  test("can be removed, and removal is audited", async () => {
    const [r] = await add("2030-03-12 08:00", "2030-03-12 16:00");
    await as("shop_admin", (tx) => tx`SELECT grip.delete_shift(${r.id})`);
    expect(await owner()`SELECT 1 FROM grip.shifts WHERE id = ${r.id}`).toHaveLength(0);
    const [a] = await owner()<Row[]>`SELECT 1 FROM grip.audit_log WHERE entity_id = ${techEmp} AND action = 'shift.removed'`;
    expect(a).toBeTruthy();
  });

  test("cannot schedule another shop's staff", async () => {
    await expect(add("2030-03-12 08:00", "2030-03-12 16:00", otherEmp)).rejects.toThrow(/staff member not found/i);
  });
});

// --- the time clock ------------------------------------------------------------------

describe("the time clock", () => {
  const clockIn = (role = "technician", wo: string | null = null, s: Shop = shop) =>
    as(role, (tx) => tx<Row[]>`SELECT grip.clock_in(${wo}) AS id`, s);
  const clockOut = (role = "technician", s: Shop = shop) =>
    as(role, (tx) => tx<Row[]>`SELECT grip.clock_out() AS mins`, s);

  test("clocking in opens an entry for the signed-in person", async () => {
    const [r] = await clockIn();
    const [t] = await owner()<Row[]>`SELECT employee_id, clock_out FROM grip.time_entries WHERE id = ${r.id}`;
    expect(t.employee_id).toBe(techEmp);
    expect(t.clock_out).toBeNull();
  });

  test("cannot clock in twice", async () => {
    await clockIn();
    await expect(clockIn()).rejects.toThrow(/already clocked in/i);
  });

  test("clocking out closes it and reports the minutes worked", async () => {
    const [r] = await clockIn();
    await owner()`UPDATE grip.time_entries SET clock_in = now() - interval '2 hours' WHERE id = ${r.id}`;
    const [o] = await clockOut();
    expect(o.mins).toBeGreaterThanOrEqual(120);
    expect(o.mins).toBeLessThan(122);
  });

  test("cannot clock out when not clocked in", async () => {
    await expect(clockOut()).rejects.toThrow(/not clocked in/i);
  });

  test("a login with no staff record cannot clock in", async () => {
    await expect(clockIn("shop_admin")).rejects.toThrow(/not linked to a staff record/i);
  });

  test("the shift clock carries no job; job time is logged separately inside it", async () => {
    const mk = async (status: string, n: number) =>
      (await owner()<Row[]>`
        INSERT INTO grip.work_orders (tenant_id, number, customer_id, vehicle_id, status)
        VALUES (${shop.tenantId}, ${n}, ${shop.customerId}, ${shop.vehicleId}, ${status}::grip.work_order_status)
        RETURNING id`)[0].id as string;
    const open = await mk("in_progress", 9101);
    const open2 = await mk("approved", 9103);
    const done = await mk("invoiced", 9102);
    const startJob = (id: string) =>
      asTenant(app(), { tenantId: shop.tenantId, userId: shop.users.technician }, (tx) =>
        tx<Row[]>`SELECT grip.start_job_time(${id}) AS id`);
    const stopJob = () =>
      asTenant(app(), { tenantId: shop.tenantId, userId: shop.users.technician }, (tx) =>
        tx<Row[]>`SELECT grip.stop_job_time() AS mins`);
    const openJobs = async () =>
      (await owner()<Row[]>`SELECT work_order_id FROM grip.job_time_entries WHERE employee_id = ${techEmp} AND clock_out IS NULL`);

    // Not on shift yet: no job time.
    await expect(startJob(open)).rejects.toThrow(/clock in to your shift first/i);

    const [shift] = await clockIn("technician");
    const [t] = await owner()<Row[]>`SELECT work_order_id FROM grip.time_entries WHERE id = ${shift.id}`;
    expect(t.work_order_id).toBeNull();

    await expect(startJob(done)).rejects.toThrow(/open work order/i);
    await startJob(open);
    expect((await openJobs()).map((r) => r.work_order_id)).toEqual([open]);

    // Starting another moves off the first: only one open at a time.
    await startJob(open2);
    expect((await openJobs()).map((r) => r.work_order_id)).toEqual([open2]);
    const all = await owner()<Row[]>`SELECT * FROM grip.job_time_entries WHERE employee_id = ${techEmp}`;
    expect(all).toHaveLength(2);

    // Stopping keeps the shift running.
    await stopJob();
    expect(await openJobs()).toHaveLength(0);
    const [still] = await owner()<Row[]>`SELECT clock_out FROM grip.time_entries WHERE id = ${shift.id}`;
    expect(still.clock_out).toBeNull();
    await expect(stopJob()).rejects.toThrow(/not on a job/i);

    // Clocking out of the shift ends the job they were on.
    await startJob(open);
    await clockOut();
    expect(await openJobs()).toHaveLength(0);
    const [ended] = await owner()<Row[]>`SELECT clock_out FROM grip.job_time_entries WHERE work_order_id = ${open} AND clock_out IS NOT NULL ORDER BY clock_in DESC LIMIT 1`;
    expect(ended.clock_out).not.toBeNull();

    await owner()`DELETE FROM grip.job_time_entries WHERE tenant_id = ${shop.tenantId}`;
    await owner()`DELETE FROM grip.time_entries WHERE tenant_id = ${shop.tenantId}`;
    await owner()`DELETE FROM grip.work_orders WHERE id IN (${open}, ${open2}, ${done})`;
  });

  test("the database itself refuses two open entries for one person", async () => {
    await owner()`INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in) VALUES (${shop.tenantId}, ${techEmp}, now())`;
    await expect(
      owner()`INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in) VALUES (${shop.tenantId}, ${techEmp}, now() + interval '1 minute')`,
    ).rejects.toThrow(/exclusion constraint/i);
  });

  test("two people can be on the clock at once", async () => {
    await clockIn("technician");
    await owner()`INSERT INTO grip.employees (tenant_id, user_id, full_name) VALUES (${shop.tenantId}, ${shop.users.service_advisor}, 'Sam')`;
    await expect(clockIn("service_advisor")).resolves.toBeDefined();
    await owner()`DELETE FROM grip.time_entries WHERE tenant_id = ${shop.tenantId}`;
    await owner()`DELETE FROM grip.employees WHERE user_id = ${shop.users.service_advisor}`;
  });
});

describe("administrator corrections to the time clock", () => {
  const save = (id: string | null, emp: string, inn: string, out: string | null, note: string | null = null) =>
    as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.save_time_entry(${id}, ${emp}, ${inn}::text::timestamp,
        ${out === null ? null : out}::text::timestamp, ${note}) AS id`);

  test("adds a missed entry at shop time and records who did it", async () => {
    const [r] = await save(null, techEmp, "2030-03-12 08:00", "2030-03-12 16:30", "forgot to clock");
    const [t] = await owner()<Row[]>`
      SELECT to_char(clock_in AT TIME ZONE 'UTC', 'HH24:MI') AS utc,
             (extract(epoch FROM clock_out - clock_in) / 3600) AS hrs, note
      FROM grip.time_entries WHERE id = ${r.id}`;
    expect(t.utc).toBe("15:00");
    expect(Number(t.hrs)).toBe(8.5);
    const [a] = await owner()<Row[]>`
      SELECT actor_user_id FROM grip.audit_log WHERE entity_id = ${techEmp} AND action = 'time.added'`;
    expect(a.actor_user_id).toBe(shop.users.shop_admin);
  });

  test("edits an entry, keeping the old values on the audit log", async () => {
    const [r] = await save(null, techEmp, "2030-03-12 08:00", "2030-03-12 16:00");
    await save(r.id, techEmp, "2030-03-12 08:00", "2030-03-12 15:00", "left early");
    const [a] = await owner()<Row[]>`
      SELECT diff FROM grip.audit_log WHERE entity_id = ${techEmp} AND action = 'time.edited'`;
    expect(a.diff.from_out).toBeTruthy();
    expect(a.diff.to_out).toBeTruthy();
    expect(a.diff.from_out).not.toBe(a.diff.to_out);
  });

  test("refuses an overlap with another entry for the same person", async () => {
    await save(null, techEmp, "2030-03-12 08:00", "2030-03-12 12:00");
    await expect(save(null, techEmp, "2030-03-12 11:00", "2030-03-12 14:00")).rejects.toThrow(/exclusion constraint/i);
  });

  test("clock-out must follow clock-in", async () => {
    await expect(save(null, techEmp, "2030-03-12 16:00", "2030-03-12 08:00")).rejects.toThrow(/after clock-in/i);
  });

  test("can delete an entry, audited", async () => {
    const [r] = await save(null, techEmp, "2030-03-12 08:00", "2030-03-12 16:00");
    await as("shop_admin", (tx) => tx`SELECT grip.delete_time_entry(${r.id})`);
    expect(await owner()`SELECT 1 FROM grip.time_entries WHERE id = ${r.id}`).toHaveLength(0);
    const [a] = await owner()<Row[]>`SELECT 1 FROM grip.audit_log WHERE entity_id = ${techEmp} AND action = 'time.removed'`;
    expect(a).toBeTruthy();
  });

  test("cannot touch another shop's staff or entries", async () => {
    await expect(save(null, otherEmp, "2030-03-12 08:00", "2030-03-12 16:00")).rejects.toThrow(/staff member not found/i);
    const [r] = await save(null, techEmp, "2030-03-12 08:00", "2030-03-12 16:00");
    await expect(as("shop_admin", (tx) => tx`SELECT grip.delete_time_entry(${r.id})`, other))
      .rejects.toThrow(/time entry not found/i);
  });
});

// --- tax rates -----------------------------------------------------------------------

describe("tax rates", () => {
  const save = (id: string | null, name: string, comps: object[], labour = true, parts = true, s: Shop = shop) =>
    as("shop_admin", (tx) => tx<Row[]>`
      SELECT grip.save_tax_rate(${id}, ${name}, ${labour}, ${parts}, ${tx.json(comps as never)}) AS id`, s);
  const comps = (id: string) => owner()<Row[]>`
    SELECT name, rate_bps FROM grip.tax_rate_components WHERE tax_rate_id = ${id} ORDER BY sort_order`;

  test("creates a rate with ordered components", async () => {
    const [r] = await save(null, "HST ON", [{ name: "HST", rate_bps: 1300 }]);
    expect((await comps(r.id)).map((c) => [c.name, c.rate_bps])).toEqual([["HST", 1300]]);
  });

  test("a shop's very first rate becomes its default", async () => {
    // The fixture gives every shop a rate; clear this one to start from none.
    await owner()`UPDATE grip.tenant_settings SET default_tax_rate_id = NULL WHERE tenant_id = ${other.tenantId}`;
    await owner()`DELETE FROM grip.tax_rates WHERE tenant_id = ${other.tenantId}`;
    const [r] = await save(null, "First rate", [{ name: "GST", rate_bps: 500 }], true, true, other);
    const [t] = await owner()<Row[]>`SELECT is_default FROM grip.tax_rates WHERE id = ${r.id}`;
    expect(t.is_default).toBe(true);
    const [s] = await owner()<Row[]>`SELECT default_tax_rate_id FROM grip.tenant_settings WHERE tenant_id = ${other.tenantId}`;
    expect(s.default_tax_rate_id).toBe(r.id);
  });

  test("editing replaces the components", async () => {
    const [r] = await save(null, "Multi", [{ name: "GST", rate_bps: 500 }, { name: "PST", rate_bps: 700 }]);
    await save(r.id, "Multi", [{ name: "GST", rate_bps: 500 }, { name: "PST", rate_bps: 800 }, { name: "Levy", rate_bps: 100 }]);
    expect((await comps(r.id)).map((c) => [c.name, c.rate_bps])).toEqual([["GST", 500], ["PST", 800], ["Levy", 100]]);
  });

  test("applies to labour and parts as chosen", async () => {
    const [r] = await save(null, "Parts only", [{ name: "PST", rate_bps: 700 }], false, true);
    const [t] = await owner()<Row[]>`SELECT applies_to_labour, applies_to_parts FROM grip.tax_rates WHERE id = ${r.id}`;
    expect([t.applies_to_labour, t.applies_to_parts]).toEqual([false, true]);
  });

  test("validates names and rates", async () => {
    await expect(save(null, "  ", [])).rejects.toThrow(/needs a name/i);
    await expect(save(null, "Bad", [{ name: "", rate_bps: 100 }])).rejects.toThrow(/every tax component needs a name/i);
    await expect(save(null, "Huge", [{ name: "X", rate_bps: 200000 }])).rejects.toThrow(/between 0% and 1000%/i);
    await expect(save(null, "Many", Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, rate_bps: 1 }))))
      .rejects.toThrow(/between 0 and 8/i);
  });

  test("two rates cannot share a name", async () => {
    await save(null, "Unique name", [{ name: "GST", rate_bps: 500 }]);
    await expect(save(null, "UNIQUE NAME", [])).rejects.toThrow(/duplicate key/i);
  });

  test("making a rate the default leaves exactly one default and updates the shop setting", async () => {
    const [a] = await save(null, "Default A", [{ name: "A", rate_bps: 100 }]);
    await as("shop_admin", (tx) => tx`SELECT grip.set_default_tax_rate(${a.id})`);
    const defaults = await owner()<Row[]>`SELECT id FROM grip.tax_rates WHERE tenant_id = ${shop.tenantId} AND is_default`;
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(a.id);
    const [s] = await owner()<Row[]>`SELECT default_tax_rate_id FROM grip.tenant_settings WHERE tenant_id = ${shop.tenantId}`;
    expect(s.default_tax_rate_id).toBe(a.id);
    await as("shop_admin", (tx) => tx`SELECT grip.set_default_tax_rate(${shop.taxRateId})`);
  });

  test("the default cannot be retired, others can", async () => {
    await expect(as("shop_admin", (tx) => tx`SELECT grip.set_tax_rate_active(${shop.taxRateId}, false)`))
      .rejects.toThrow(/make another rate the default/i);
    const [r] = await save(null, "Retire me", []);
    await as("shop_admin", (tx) => tx`SELECT grip.set_tax_rate_active(${r.id}, false)`);
    const [t] = await owner()<Row[]>`SELECT is_active FROM grip.tax_rates WHERE id = ${r.id}`;
    expect(t.is_active).toBe(false);
  });

  test("a retired rate cannot become the default", async () => {
    const [r] = await save(null, "Retired", []);
    await as("shop_admin", (tx) => tx`SELECT grip.set_tax_rate_active(${r.id}, false)`);
    await expect(as("shop_admin", (tx) => tx`SELECT grip.set_default_tax_rate(${r.id})`)).rejects.toThrow(/not found/i);
  });

  test("another shop cannot edit or retire this shop's rates", async () => {
    await expect(save(shop.taxRateId, "Hijacked", [], true, true, other)).rejects.toThrow(/tax rate not found/i);
    await expect(as("shop_admin", (tx) => tx`SELECT grip.set_tax_rate_active(${shop.taxRateId}, false)`, other))
      .rejects.toThrow(/tax rate not found/i);
  });
});
